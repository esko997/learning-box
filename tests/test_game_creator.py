"""Creator API boundaries using temporary data and synthetic art; no paid calls."""
import copy
import io
import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from fakemon.game_creator import MAX_RECIPE, register_game_creator

PREFIX = "/api/game-creator"


class GameCreatorBoundaries(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        # Any attempt to use the card database would corrupt/fail this sentinel.
        self.cards = self.root / "cards.sqlite"
        self.cards.write_bytes(b"untouched card collection")
        self.state = SimpleNamespace(s=SimpleNamespace(data_dir=self.root))
        self.open_client()

    def open_client(self):
        @asynccontextmanager
        async def lifespan(api):
            yield
            if hasattr(self.state, "game_creator"):
                self.state.game_creator.db.close()
                del self.state.game_creator

        api = FastAPI(lifespan=lifespan)
        register_game_creator(api, lambda: self.state)
        self.client = TestClient(api)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.assertEqual(self.cards.read_bytes(), b"untouched card collection")
        self.temp.cleanup()

    @staticmethod
    def picture(color=(30, 90, 170, 67)):
        output = io.BytesIO()
        with Image.new("RGBA", (12, 8), color) as image:
            image.save(output, "PNG")
        return output.getvalue()

    def upload(self, raw=None, original_id=None):
        response = self.client.post(PREFIX + "/assets", data={} if original_id is None else {"original_id": original_id},
                                    files={"image": ("../untrusted.png", self.picture() if raw is None else raw, "image/png")})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def recipe(self):
        asset = self.upload()
        return {"schema_version": 1, "title": "My sky game", "template": "flyer", "theme": "sky",
                "difficulty": "gentle", "shots": "bubbles", "player": {"name": "Cloud", "asset_id": asset["id"]},
                "enemies": [{"name": "Twirl", "asset_id": asset["id"], "behavior": "weave", "speed": "slow"}]}

    def create(self, recipe):
        response = self.client.post(PREFIX + "/games", json=recipe)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_library_and_images_survive_restart_without_touching_cards(self):
        recipe = self.recipe()
        recipe["title"] = "  A big cast  "
        recipe["player"]["name"] = "  Cloud  "
        recipe["enemies"] = [dict(recipe["enemies"][0], name=f"Guest {index}") for index in range(80)]
        saved = self.create(recipe)
        self.assertEqual(saved["title"], "A big cast")
        self.assertEqual(saved["player"]["name"], "Cloud")
        self.assertEqual(len(saved["enemies"]), 80)
        self.client.__exit__(None, None, None)
        self.open_client()
        self.assertEqual(self.client.get(PREFIX + "/games").json(), [saved])
        self.assertEqual(self.client.get(f"{PREFIX}/games/{saved['id']}").json(), saved)
        self.assertEqual(self.client.get(f"{PREFIX}/assets/{saved['player']['asset_id']}/image").status_code, 200)
        self.assertTrue((self.root / "games.sqlite").is_file())
        self.assertFalse((self.root / "media").exists())

    def test_stale_revision_cannot_overwrite_game(self):
        recipe = self.recipe()
        saved = self.create(recipe)
        url = f"{PREFIX}/games/{saved['id']}"
        response = self.client.put(url, json=dict(recipe, title="Changed title", revision=1))
        self.assertEqual(response.status_code, 200)
        updated = response.json()
        self.assertEqual(updated["revision"], 2)
        self.assertEqual(updated["created_at"], saved["created_at"])
        self.assertEqual(self.client.put(url, json=dict(recipe, revision=1)).status_code, 409)
        self.assertEqual(self.client.get(url).json(), updated)

    def test_duplicate_is_an_independent_recipe_with_shared_immutable_art(self):
        recipe = self.recipe()
        recipe["title"] = "G" * 100
        original = self.create(recipe)
        response = self.client.post(f"{PREFIX}/games/{original['id']}/duplicate")
        self.assertEqual(response.status_code, 200)
        duplicate = response.json()
        self.assertNotEqual(duplicate["id"], original["id"])
        self.assertEqual(duplicate["revision"], 1)
        self.assertTrue(duplicate["title"].endswith(" copy"))
        self.assertLessEqual(len(duplicate["title"]), 100)
        self.assertEqual(duplicate["player"], original["player"])
        edited = copy.deepcopy(recipe)
        edited["player"]["name"] = "Different hero"
        edited["enemies"][0]["behavior"] = "chase"
        self.assertEqual(self.client.put(f"{PREFIX}/games/{duplicate['id']}", json=dict(edited, revision=1)).status_code, 200)
        self.assertEqual(self.client.get(f"{PREFIX}/games/{original['id']}").json(), original)
        self.assertEqual(len(self.client.get(PREFIX + "/games").json()), 2)

    def test_invalid_recipes_and_missing_assets_are_not_saved(self):
        recipe = self.recipe()
        variants = [dict(recipe, schema_version=version) for version in (2, True, 1.0, "1")]
        variants += [dict(recipe, **change) for change in (
            {"theme": "remote"}, {"template": "generated-code"}, {"difficulty": "impossible"},
            {"shots": "lasers"}, {"title": "   "}, {"title": "x" * 101}, {"enemies": []}, {"code": "alert(1)"},
            {"player": {"name": "Cloud", "asset_id": "https://example.invalid/image.png"}},
            {"player": {"name": "Cloud", "asset_id": str(uuid4())}},
            {"player": dict(recipe["player"], name=" " )},
            {"player": dict(recipe["player"], name="x" * 61)},
            {"player": dict(recipe["player"], remote_url="https://example.invalid/")},
            {"enemies": [dict(recipe["enemies"][0], behavior="teleport")]},
            {"enemies": [dict(recipe["enemies"][0], speed="lightning")]},
        )]
        for variant in variants:
            with self.subTest(variant=variant):
                self.assertEqual(self.client.post(PREFIX + "/games", json=variant).status_code, 422)
        self.assertEqual(self.client.get(PREFIX + "/games").json(), [])
        original = self.create(recipe)
        invalid = dict(recipe, player={"name": "Missing", "asset_id": str(uuid4())}, revision=1)
        self.assertEqual(self.client.put(f"{PREFIX}/games/{original['id']}", json=invalid).status_code, 422)
        self.assertEqual(self.client.get(f"{PREFIX}/games/{original['id']}").json(), original)

    def test_crop_lineage_and_transparency_preserve_original(self):
        original = self.upload()
        before = self.client.get(original["url"]).content
        self.assertEqual(original["id"], original["original_id"])
        with Image.open(io.BytesIO(before)) as image:
            self.assertEqual(image.mode, "RGBA")
            self.assertEqual(image.getpixel((0, 0)), (30, 90, 170, 67))
        crop = self.upload(self.picture((80, 20, 40, 0)), original["id"])
        recrop = self.upload(self.picture((50, 60, 70, 128)), crop["id"])
        self.assertEqual(recrop["original_id"], original["id"])
        self.assertEqual(recrop["original_url"], original["url"])
        self.assertEqual(len({original["id"], crop["id"], recrop["id"]}), 3)
        self.assertEqual(self.client.get(original["url"]).content, before)
        self.assertEqual(self.client.get(f"{PREFIX}/assets/{crop['id']}").json(), crop)
        self.assertEqual(self.client.put(original["url"], content=b"replace").status_code, 405)

    def test_exif_orientation_is_applied_and_metadata_removed(self):
        output = io.BytesIO()
        with Image.new("RGB", (12, 8), (15, 25, 35)) as image:
            exif = Image.Exif()
            exif[274] = 6
            exif[270] = "Private camera note"
            image.save(output, "JPEG", exif=exif)
        asset = self.upload(output.getvalue())
        response = self.client.get(asset["url"])
        self.assertEqual(response.headers["content-type"], "image/png")
        with Image.open(io.BytesIO(response.content)) as normalized:
            self.assertEqual(normalized.size, (8, 12))
            self.assertEqual(dict(normalized.getexif()), {})

    def test_bad_uploads_and_missing_files_have_visible_errors(self):
        response = self.client.post(PREFIX + "/assets", files={"image": ("bad.png", b"not an image", "image/png")})
        self.assertEqual(response.status_code, 422)
        response = self.client.post(PREFIX + "/assets", files={"image": ("ok.png", self.picture(), "image/png")},
                                    data={"original_id": str(uuid4())})
        self.assertEqual(response.status_code, 404)
        with patch("fakemon.game_creator.MAX_PIXELS", 50):
            response = self.client.post(PREFIX + "/assets", files={"image": ("large.png", self.picture(), "image/png")})
        self.assertEqual(response.status_code, 413)
        recipe = self.recipe()
        asset_id = recipe["player"]["asset_id"]
        (self.root / "game-assets" / f"{asset_id}.png").unlink()
        self.assertEqual(self.client.get(f"{PREFIX}/assets/{asset_id}/image").status_code, 404)
        self.assertEqual(self.client.post(PREFIX + "/games", json=recipe).status_code, 422)
        self.assertEqual(self.client.get(f"{PREFIX}/assets/not-a-uuid").status_code, 404)
        self.assertEqual(self.client.get(f"{PREFIX}/games/{uuid4()}").status_code, 404)

    def test_request_limits_apply_with_and_without_content_length(self):
        oversized = b" " * (MAX_RECIPE + 1)
        self.assertEqual(self.client.post(PREFIX + "/games", content=oversized).status_code, 413)
        self.assertEqual(self.client.post(PREFIX + "/games", content=iter([oversized[:100], oversized[100:]])).status_code, 413)
        with patch("fakemon.game_creator.MAX_MULTIPART", 100):
            response = self.client.post(PREFIX + "/assets", files={"image": ("picture.png", self.picture(), "image/png")})
            self.assertEqual(response.status_code, 413)
        with patch("fakemon.game_creator.MAX_UPLOAD", 10):
            response = self.client.post(PREFIX + "/assets", files={"image": ("picture.png", self.picture(), "image/png")})
            self.assertEqual(response.status_code, 413)
        self.assertEqual(self.client.post(PREFIX + "/games", content=b"{").status_code, 422)


if __name__ == "__main__":
    unittest.main()
