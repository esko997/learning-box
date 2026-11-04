"""Saved game recipes and immutable artwork, separate from the card binder."""
from __future__ import annotations

import io
import json
import os
import sqlite3
import tempfile
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError, field_validator
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

PREFIX = "/api/game-creator"
MAX_RECIPE = 256 * 1024
MAX_UPLOAD = 25 * 1024 * 1024
MAX_MULTIPART = MAX_UPLOAD + 64 * 1024
MAX_PIXELS = 40_000_000
MAX_IMAGE_EDGE = 16_384
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class CreatorModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Actor(CreatorModel):
    name: Name
    asset_id: str

    @field_validator("asset_id")
    @classmethod
    def valid_asset_id(cls, value: str) -> str:
        return str(UUID(value))


class Enemy(Actor):
    behavior: Literal["straight", "weave", "chase"]
    speed: Literal["slow", "normal", "fast"]


class Recipe(CreatorModel):
    schema_version: Literal[1]
    title: Title
    template: Literal["flyer", "puzzle"]
    theme: Literal["sky", "space", "forest"]
    difficulty: Literal["gentle", "normal", "lively"]
    shots: Literal["bubbles", "stars"]
    player: Actor
    enemies: list[Enemy] = Field(min_length=1)

    @field_validator("schema_version", mode="before")
    @classmethod
    def integer_version(cls, value):
        if type(value) is not int:
            raise ValueError("Schema version must be the integer 1")
        return value


class SaveRecipe(Recipe):
    revision: int = Field(ge=1)


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def canonical_id(value: str, what: str) -> str:
    try:
        return str(UUID(value))
    except (ValueError, AttributeError) as exc:
        raise HTTPException(404, f"No such {what}") from exc


def normalize_image(raw: bytes) -> bytes:
    """Decode bounded raster art, orient it, and discard metadata, not alpha."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw), formats=["JPEG", "PNG", "WEBP", "GIF", "BMP", "TIFF"]) as image:
                width, height = image.size
                if width * height > MAX_PIXELS or max(width, height) > MAX_IMAGE_EDGE:
                    raise HTTPException(413, "This picture is too large. Choose one under 40 megapixels and 16384 pixels per side.")
                # Load the first frame only; saved game artwork is always a still PNG.
                image.load()
                oriented = ImageOps.exif_transpose(image)
                try:
                    with oriented.convert("RGBA") as normalized:
                        normalized.info.clear()
                        output = io.BytesIO()
                        normalized.save(output, format="PNG")
                        return output.getvalue()
                finally:
                    oriented.close()
    except (Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise HTTPException(413, "This picture is too large. Choose a smaller image.") from exc
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
        raise HTTPException(422, "This picture could not be opened. Choose a PNG, JPEG, WebP, GIF, BMP or TIFF image.") from exc


class GameCreatorStore:
    def __init__(self, root: Path):
        self.assets = root / "game-assets"
        self.assets.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(root / "games.sqlite", isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY,
                original_id TEXT NOT NULL REFERENCES assets(id),
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS games (
                id TEXT PRIMARY KEY, recipe TEXT NOT NULL,
                revision INTEGER NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
        """)

    def asset_path(self, asset_id: str) -> Path:
        return self.assets / (canonical_id(asset_id, "picture") + ".png")

    def asset(self, asset_id: str) -> dict:
        asset_id = canonical_id(asset_id, "picture")
        row = self.db.execute("SELECT id, original_id FROM assets WHERE id=?", (asset_id,)).fetchone()
        if row is None or not self.asset_path(asset_id).is_file():
            raise HTTPException(404, "No such picture. Upload it again before saving.")
        original_id = row["original_id"]
        if not self.asset_path(original_id).is_file():
            raise HTTPException(404, "The original picture is missing. Upload it again before saving.")
        return {"id": asset_id, "url": f"{PREFIX}/assets/{asset_id}/image",
                "original_id": original_id, "original_url": f"{PREFIX}/assets/{original_id}/image"}

    def add_asset(self, png: bytes, original_id: str | None) -> dict:
        asset_id = str(uuid4())
        root_id = self.asset(original_id)["original_id"] if original_id else asset_id
        target = self.asset_path(asset_id)
        temporary = None
        published = False
        try:
            with tempfile.NamedTemporaryFile(dir=self.assets, prefix=".upload-", delete=False) as handle:
                temporary = Path(handle.name)
                handle.write(png)
                handle.flush()
                os.fsync(handle.fileno())
            # Publishing a hard link is atomic and cannot replace an existing image.
            os.link(temporary, target)
            published = True
            self.db.execute("INSERT INTO assets VALUES (?, ?, ?)", (asset_id, root_id, timestamp()))
        except BaseException:
            if published:
                target.unlink(missing_ok=True)
            raise
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        return self.asset(asset_id)

    @staticmethod
    def public_game(row) -> dict:
        return json.loads(row["recipe"]) | {key: row[key] for key in ("id", "revision", "created_at", "updated_at")}

    def game(self, game_id: str) -> dict:
        game_id = canonical_id(game_id, "game")
        row = self.db.execute("SELECT * FROM games WHERE id=?", (game_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "No such saved game")
        return self.public_game(row)

    def list_games(self) -> list[dict]:
        return [self.public_game(row) for row in self.db.execute("SELECT * FROM games ORDER BY updated_at DESC, id")]

    def encoded_recipe(self, recipe: Recipe) -> str:
        for asset_id in {recipe.player.asset_id, *(enemy.asset_id for enemy in recipe.enemies)}:
            try:
                self.asset(asset_id)
            except HTTPException as exc:
                raise HTTPException(422, "A character picture is missing. Upload it again before saving.") from exc
        text = json.dumps(recipe.model_dump(exclude={"revision"}), ensure_ascii=False, separators=(",", ":"))
        if len(text.encode("utf-8")) > MAX_RECIPE:
            raise HTTPException(413, "This game recipe is too large to save.")
        return text

    def create(self, recipe: Recipe) -> dict:
        text = self.encoded_recipe(recipe)
        game_id = str(uuid4())
        now = timestamp()
        self.db.execute("INSERT INTO games VALUES (?, ?, 1, ?, ?)", (game_id, text, now, now))
        return self.game(game_id)

    def save(self, game_id: str, recipe: SaveRecipe) -> dict:
        previous = self.game(game_id)
        conflict = "This game changed in another window. Your draft is still here; reopen the saved game before saving again."
        if previous["revision"] != recipe.revision:
            raise HTTPException(409, conflict)
        text = self.encoded_recipe(recipe)
        result = self.db.execute(
            "UPDATE games SET recipe=?, revision=revision+1, updated_at=? WHERE id=? AND revision=?",
            (text, timestamp(), previous["id"], recipe.revision),
        )
        if result.rowcount != 1:
            raise HTTPException(409, conflict)
        return self.game(previous["id"])

    def duplicate(self, game_id: str) -> dict:
        original = self.game(game_id)
        data = {key: original[key] for key in Recipe.model_fields}
        data["title"] = original["title"][:95].rstrip() + " copy"
        return self.create(Recipe.model_validate(data))


class UploadTooLarge(MultiPartException):
    pass


async def bounded_stream(request: Request, limit: int, *, multipart: bool = False):
    message = "This picture is too large. Choose one under 25 MB." if multipart else "This game recipe is too large to save."
    total = 0
    length = request.headers.get("content-length")
    if length is not None:
        try:
            total_length = int(length)
        except ValueError as exc:
            raise HTTPException(400, "Invalid content length") from exc
        if total_length > limit:
            raise HTTPException(413, message)
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            if multipart:
                # The multipart parser closes any partial temporary uploads on this exception.
                raise UploadTooLarge(message)
            raise HTTPException(413, message)
        yield chunk


async def read_recipe(request: Request, model: type[Recipe]) -> Recipe:
    raw = bytearray()
    async for chunk in bounded_stream(request, MAX_RECIPE):
        raw.extend(chunk)
    try:
        return model.model_validate_json(raw)
    except ValidationError as exc:
        raise HTTPException(422, exc.errors(include_url=False, include_context=False, include_input=False)) from exc


def register_game_creator(api: FastAPI, get_app) -> None:
    def store() -> GameCreatorStore:
        app = get_app()
        if not hasattr(app, "game_creator"):
            app.game_creator = GameCreatorStore(app.s.data_dir)
        return app.game_creator

    @api.post(PREFIX + "/assets")
    async def upload_asset(request: Request):
        if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "multipart/form-data":
            raise HTTPException(415, "Upload a picture using multipart form data.")
        parser = MultiPartParser(request.headers, bounded_stream(request, MAX_MULTIPART, multipart=True),
                                 max_files=1, max_fields=1, max_part_size=1024)
        try:
            form = await parser.parse()
        except UploadTooLarge as exc:
            raise HTTPException(413, exc.message) from exc
        except MultiPartException as exc:
            raise HTTPException(422, exc.message) from exc
        try:
            if any(key not in {"image", "original_id"} for key in form):
                raise HTTPException(422, "Only image and original_id fields are supported.")
            image = form.get("image")
            original_id = form.get("original_id")
            if not isinstance(image, UploadFile) or (original_id is not None and not isinstance(original_id, str)):
                raise HTTPException(422, "Choose a picture to upload.")
            if original_id is not None:
                original_id = store().asset(original_id)["original_id"]
            raw = await image.read(MAX_UPLOAD + 1)
            if len(raw) > MAX_UPLOAD:
                raise HTTPException(413, "This picture is too large. Choose one under 25 MB.")
            png = await run_in_threadpool(normalize_image, raw)
            return store().add_asset(png, original_id)
        finally:
            await form.close()

    @api.get(PREFIX + "/assets/{asset_id}")
    async def get_asset(asset_id: str):
        return store().asset(asset_id)

    @api.get(PREFIX + "/assets/{asset_id}/image")
    async def get_asset_image(asset_id: str):
        asset = store().asset(asset_id)
        return FileResponse(store().asset_path(asset["id"]), media_type="image/png",
                            headers={"X-Content-Type-Options": "nosniff"})

    @api.get(PREFIX + "/games")
    async def list_games():
        return store().list_games()

    @api.post(PREFIX + "/games")
    async def create_game(request: Request):
        return store().create(await read_recipe(request, Recipe))

    @api.get(PREFIX + "/games/{game_id}")
    async def get_game(game_id: str):
        return store().game(game_id)

    @api.put(PREFIX + "/games/{game_id}")
    async def save_game(game_id: str, request: Request):
        return store().save(game_id, await read_recipe(request, SaveRecipe))

    @api.post(PREFIX + "/games/{game_id}/duplicate")
    async def duplicate_game(game_id: str, request: Request):
        async for chunk in bounded_stream(request, MAX_RECIPE):
            if chunk:
                raise HTTPException(422, "Duplicate a game without a request body.")
        return store().duplicate(game_id)
