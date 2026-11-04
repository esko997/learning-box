import { RibbonFlight, WIDTH, HEIGHT } from "./ribbon-flight-engine.js";
import { PuzzleBattle, COLS, ROWS } from "./puzzle-battle-engine.js";
import { loadShell } from "./shell.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const preview = params.get("preview") === "1";
const embedded = preview && window.parent !== window;
const canvas = $("sky");
const ctx = canvas.getContext("2d");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const symbols = ["●", "◆", "★", "▲", "♥"];
const tileNames = ["blue circle", "orange diamond", "yellow star", "green triangle", "purple heart"];
const speedScales = { slow: 0.72, normal: 1, fast: 1.35 };
const difficulties = {
  gentle: { pacing: 0.72, speedScale: 0.8, riseMs: 16000, computerMs: 3600, computerMatchChoices: 2 },
  normal: { pacing: 1, speedScale: 1, riseMs: 12000, computerMs: 2400, computerMatchChoices: 3 },
  lively: { pacing: 1.3, speedScale: 1.15, riseMs: 9000, computerMs: 1500, computerMatchChoices: 4 },
};
const themes = {
  sky: { top: "#a6dff7", bottom: "#f3fbff", decoration: "#ffffff", shot: "#287eb4" },
  space: { top: "#14162e", bottom: "#403365", decoration: "#d4daff", shot: "#bce9ff" },
  forest: { top: "#a0d2b2", bottom: "#e5efc5", decoration: "#4a8f6c", shot: "#145c57" },
};
let recipe = null;
let previewAccepted = false;
let game = null;
let images = new Map();
let loading = false;
let loadController = null;
let frame = 0;
let lastTime = 0;
let lastPaint = 0;
let drag = null;
let target = null;
let anchor = null;
let previousCells = [];
const keys = new Set();
const cursor = { row: ROWS - 2, col: 2 };
const cells = {};
const nextCells = {};

function text(element, value) {
  const next = String(value);
  if (element.textContent !== next) element.textContent = next;
}
function status() { return !game ? "loading" : recipe.template === "flyer" ? game.status : game.state.status; }
function rival() { return recipe.enemies[Number($("rival-choice").value) || 0]; }
function assetURL(id) { return `/api/game-creator/assets/${encodeURIComponent(id)}/image`; }
function validRecipe(value) {
  const label = (s, max) => typeof s === "string" && s.trim().length > 0 && s.length <= max;
  const actor = a => a && label(a.name, 60) && label(a.asset_id, 200);
  return value && value.schema_version === 1 && label(value.title, 100) &&
    ["flyer", "puzzle"].includes(value.template) && Object.hasOwn(themes, value.theme) &&
    Object.hasOwn(difficulties, value.difficulty) && ["bubbles", "stars"].includes(value.shots) &&
    actor(value.player) && Array.isArray(value.enemies) && value.enemies.length > 0 &&
    value.enemies.every(a => actor(a) && ["straight", "weave", "chase"].includes(a.behavior) &&
      Object.hasOwn(speedScales, a.speed));
}

function loadImage(id, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let timer;
    const finish = error => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      image.onload = null;
      image.onerror = null;
      if (error) { image.src = ""; reject(error); }
      else resolve(image);
    };
    const abort = () => finish(new Error("Loading stopped. Tap Try again to reload the drawings."));
    image.onload = () => finish();
    image.onerror = () => finish(new Error("A character drawing could not load. Check your connection and try again. If it is still missing, open the editor and upload that drawing again."));
    timer = setTimeout(() => finish(new Error("The drawings took too long to load. Check your connection and try again.")), 20000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else image.src = assetURL(id);
  });
}

async function loadAssets(signal) {
  const ids = [...new Set([recipe.player.asset_id, ...recipe.enemies.map(actor => actor.asset_id)])];
  const loaded = new Map();
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (index < ids.length) {
      const id = ids[index++];
      loaded.set(id, await loadImage(id, signal));
    }
  }));
  return loaded;
}

async function load() {
  if (loading) return;
  loading = true;
  pause();
  game = null;
  $("game").hidden = true;
  $("error-panel").hidden = true;
  $("loading").hidden = false;
  text($("loading"), "Loading your game and drawings…");
  loadController = new AbortController();
  const controller = loadController;
  let requestTimer;
  try {
    if (!preview) {
      const id = params.get("id");
      if (!id) throw new Error("No saved game was selected. Open My games and choose Play on a saved game.");
      requestTimer = setTimeout(() => controller.abort(), 20000);
      const response = await fetch(`/api/game-creator/games/${encodeURIComponent(id)}`, { signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 404 ? "This saved game could not be found. Open My games to choose another one." : "The saved game could not load. Check your connection and try again.");
      recipe = await response.json();
      clearTimeout(requestTimer);
    }
    if (!validRecipe(recipe)) throw new Error("This game has missing or unsupported settings. Open it in the editor and save it again.");
    images = await loadAssets(controller.signal);
    setup();
    $("game").hidden = false;
    resize();
  } catch (error) {
    controller.abort();
    text($("error-message"), error.name === "AbortError" ? "Loading was interrupted or timed out. Check your connection and try again." : error.message || "The game could not load. Try again.");
    $("error-panel").hidden = false;
  } finally {
    clearTimeout(requestTimer);
    loading = false;
    $("loading").hidden = true;
    if (loadController === controller) loadController = null;
  }
}

function setup() {
  document.body.dataset.theme = recipe.theme;
  document.body.dataset.template = recipe.template;
  text($("title"), recipe.title);
  void loadShell(recipe.title);
  const flyer = recipe.template === "flyer";
  $("flyer").hidden = !flyer;
  $("puzzle").hidden = flyer;
  $("rival-picker").hidden = flyer;
  $("raise").hidden = flyer;
  $("rules").hidden = true;
  $("rules-toggle").setAttribute("aria-expanded", "false");
  if (flyer) {
    if (!ctx) throw new Error("This browser cannot draw the flying game. Please use a browser with canvas support.");
    game = new RibbonFlight(Math.random, {
      ...difficulties[recipe.difficulty], shotOffsetX: 36,
      enemyTypes: recipe.enemies.map(actor => ({ behavior: actor.behavior, speed: speedScales[actor.speed] })),
    });
    text($("instructions"), `Help ${recipe.player.name} fly! Drag in the sky, or use arrows / WASD. Shots fire automatically.`);
    text($("rules-text"), "Drag anywhere in the sky to steer. On a keyboard, click the sky and use arrows or WASD; P pauses. Pop flyers for 10 points each. Every character in your roster takes a turn entering the sky with its chosen movement and speed. Straight flyers hold their height, weaving flyers wave up and down, and chasing flyers turn toward you. Dodge them to keep your three hearts. A glowing shield protects you briefly after a bump. Flyers that pass you do not cost a heart. Keep going for a high score; replay after your hearts run out. Turning your tablet sideways gives you a bigger sky.");
    const roster = document.createDocumentFragment();
    for (const actor of recipe.enemies) {
      const item = document.createElement("li");
      const image = images.get(actor.asset_id).cloneNode();
      image.alt = "";
      const label = document.createElement("span");
      text(label, `${actor.name} · ${actor.behavior} · ${actor.speed}`);
      item.append(image, label);
      roster.append(item);
    }
    $("roster").replaceChildren(roster);
  } else {
    $("rival-choice").replaceChildren(...recipe.enemies.map((actor, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      text(option, `${index + 1}. ${actor.name}`);
      return option;
    }));
    text($("instructions"), "Tap two neighbors in the same row to swap. Match three across or down. Help your character keep the stack below the top!");
    text($("rules-text"), "You play the left board (the first board on narrow screens). Your chosen rival plays the other board. Tap a tile, then its left or right neighbor to swap. Match three or more of one shape across or down. Tiles fall into gaps; falling matches make chains. Match four or make a chain to send an extra row to your rival. Both stacks rise over time. If a stack stays at the top for five seconds, that character loses; if both reach the limit together, it is a draw. Add a row when you want more tiles. Keyboard: focus your board, use arrows to choose a pair, Space or Enter to swap, R to add a row, P to pause. Difficulty changes the rise speed and how quickly and accurately the computer swaps. Choose any rival before starting or after a battle.");
    makeBoards();
    preparePuzzle();
  }
  render();
}

function preparePuzzle() {
  game = new PuzzleBattle(Math.random, { ...difficulties[recipe.difficulty], rivalName: rival().name });
  anchor = null;
  previousCells = [];
  cursor.row = ROWS - 2;
  cursor.col = 2;
  for (const [side, actor] of [["player", recipe.player], ["rival", rival()]]) {
    text($(`${side}-name`), actor.name);
    $(`${side}-art`).src = images.get(actor.asset_id).src;
    $(`${side}-art`).alt = `${actor.name}, your drawn character`;
  }
}

function makeBoards() {
  for (const side of ["player", "rival"]) {
    cells[side] = Array.from({ length: ROWS * COLS }, (_, index) => {
      const cell = document.createElement(side === "player" ? "button" : "span");
      cell.className = "tile";
      if (side === "player") {
        cell.type = "button";
        cell.tabIndex = -1;
        cell.addEventListener("click", () => selectCell(index));
      } else cell.setAttribute("aria-hidden", "true");
      return cell;
    });
    nextCells[side] = Array.from({ length: COLS }, () => {
      const tile = document.createElement("span");
      tile.className = "tile";
      return tile;
    });
    $(`${side}-board`).replaceChildren(...cells[side]);
    $(`${side}-next`).replaceChildren(...nextCells[side]);
  }
}

function playable() { return recipe?.template === "puzzle" && status() === "playing" && game.state.player.phase === "idle"; }
function selectCell(index) {
  if (!playable()) return;
  const row = Math.floor(index / COLS), col = index % COLS;
  if (anchor !== null && Math.floor(anchor / COLS) === row && Math.abs(index - anchor) === 1) {
    cursor.row = row;
    cursor.col = Math.min(col, anchor % COLS);
    game.swap(row, cursor.col);
    anchor = null;
  } else {
    anchor = index;
    cursor.row = row;
    cursor.col = Math.min(col, COLS - 2);
  }
  render();
}
function paintTile(tile, kind) {
  const value = kind === null ? "empty" : String(kind);
  if (tile.dataset.kind !== value) {
    tile.dataset.kind = value;
    text(tile, kind === null ? "" : symbols[kind]);
  }
}
function drawPuzzle() {
  const state = game.state;
  if (state.player.cells.some((kind, index) => previousCells[index] !== kind)) anchor = null;
  previousCells = state.player.cells.slice();
  const active = playable();
  for (const side of ["player", "rival"]) {
    const board = state[side];
    const matches = new Set(board.matches);
    cells[side].forEach((tile, index) => {
      const kind = board.cells[index];
      paintTile(tile, kind);
      tile.classList.toggle("clearing", matches.has(index));
      if (side === "player") {
        const selected = active && (anchor !== null ? anchor === index :
          Math.floor(index / COLS) === cursor.row && [cursor.col, cursor.col + 1].includes(index % COLS));
        tile.classList.toggle("selected", selected);
        tile.disabled = !active;
        tile.setAttribute("aria-pressed", String(selected));
        tile.setAttribute("aria-label", `Row ${Math.floor(index / COLS) + 1}, column ${index % COLS + 1}: ${kind === null ? "empty" : tileNames[kind]}`);
      }
    });
    nextCells[side].forEach((tile, index) => paintTile(tile, board.nextRow[index]));
    text($(`${side}-score`), `${board.score} points · ${board.cleared} cleared`);
    text($(`${side}-message`), `${board.pendingRows ? `${board.pendingRows} incoming row${board.pendingRows === 1 ? "" : "s"}! ` : ""}${board.message}`);
    const danger = board.cells.slice(0, COLS).some(kind => kind !== null);
    $(`${side}-well`).classList.toggle("danger", danger);
    text($(`${side}-danger`), danger ? `Clear the top! ${Math.max(0, Math.ceil((5000 - board.dangerMs) / 1000))} seconds` : "Keep below the top");
  }
  $("player-board").setAttribute("aria-label", `Your puzzle board. Cursor row ${cursor.row + 1}, columns ${cursor.col + 1} and ${cursor.col + 2}. Arrows move, Space swaps.`);
  $("rival-board").setAttribute("aria-label", `${rival().name}'s puzzle board. ${state.rival.cleared} cleared. ${state.rival.pendingRows} incoming rows.`);
  $("raise").disabled = !active;
  $("rival-choice").disabled = ["playing", "paused"].includes(state.status);
}

function circle(x, y, radius, fill, stroke = null) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}
function sprite(image, x, y, size) {
  const scale = size / Math.max(image.naturalWidth, image.naturalHeight);
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  ctx.drawImage(image, x - w / 2, y - h / 2, w, h);
}
function star(x, y) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = i * Math.PI / 5 - Math.PI / 2;
    const r = i % 2 ? 4 : 10;
    const px = x + Math.cos(angle) * r, py = y + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = "#ffe46d";
  ctx.fill();
  ctx.strokeStyle = "#a46819";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
function drawFlight() {
  const theme = themes[recipe.theme];
  ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  gradient.addColorStop(0, theme.top);
  gradient.addColorStop(1, theme.bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const scroll = reduced.matches ? 0 : game.elapsed * 28;
  for (let i = 0; i < 14; i++) {
    const x = ((i * 137 - scroll) % 1120 + 1120) % 1120 - 80;
    const y = 45 + (i * 103) % 450;
    if (recipe.theme === "space") circle(x, y, i % 3 + 1, theme.decoration);
    else if (recipe.theme === "forest") {
      ctx.fillStyle = theme.decoration;
      ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.moveTo(x, HEIGHT - 90 - i % 3 * 20);
      ctx.lineTo(x - 45, HEIGHT); ctx.lineTo(x + 45, HEIGHT); ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = 0.55;
      circle(x, y, 23, theme.decoration);
      circle(x + 26, y + 9, 28, theme.decoration);
      ctx.globalAlpha = 1;
    }
  }
  for (const shot of game.shots) {
    if (recipe.shots === "stars") star(shot.x, shot.y);
    else {
      circle(shot.x, shot.y, 8, "#d9f7ff99", theme.shot);
      circle(shot.x - 2, shot.y - 2, 2, "white");
    }
  }
  for (const enemy of game.enemies) sprite(images.get(recipe.enemies[enemy.kind].asset_id), enemy.x, enemy.y, 60);
  for (const pop of game.pops) {
    if (reduced.matches) continue;
    ctx.globalAlpha = pop.life / 0.28;
    circle(pop.x, pop.y, 10 + (1 - pop.life / 0.28) * 24, "#fff4af77", theme.shot);
  }
  ctx.globalAlpha = 1;
  if (game.player.shield > 0) circle(game.player.x, game.player.y, 39, "#d5f6ff99", "#318ed2");
  sprite(images.get(recipe.player.asset_id), game.player.x, game.player.y, 64);
  text($("hearts"), `Hearts: ${game.player.hearts} / 3`);
  text($("score"), game.score);
  $("flight-overlay").hidden = game.status === "playing";
  text($("overlay-title"), game.status === "paused" ? "Paused" : game.status === "over" ? "Nice flying!" : "Ready to fly?");
  text($("overlay-detail"), game.status === "over" ? `${game.score} points. Try for a new high score!` :
    game.status === "paused" ? "Tap Resume when you're ready." : "Tap Start flying. Your drawings are ready!");
}

function render() {
  if (!game) return;
  const current = status();
  const flyer = recipe.template === "flyer";
  const ended = ["over", "won", "lost", "draw"].includes(current);
  $("start").hidden = ["playing", "paused"].includes(current);
  text($("start"), ended ? "Play again" : flyer ? "Start flying" : "Start battle");
  $("pause").disabled = !["playing", "paused"].includes(current);
  text($("pause"), current === "paused" ? "Resume" : "Pause");
  let message = "Ready when you are. Tap Start to play.";
  if (current === "paused") message = "Paused. Tap Resume when you're ready.";
  if (current === "playing") message = flyer ? `Keep flying! ${game.player.hearts} hearts left.` :
    anchor === null ? "Tap two neighbors in the same row to swap." : "Now tap the tile just to its left or right.";
  if (current === "over") message = `Flight finished! You scored ${game.score} points.`;
  if (current === "won") message = `${recipe.player.name} wins! ${rival().name}'s stack reached the top.`;
  if (current === "lost") message = `${rival().name} wins this time. Try again!`;
  if (current === "draw") message = "Both stacks reached the top. It's a draw!";
  if (flyer) drawFlight(); else drawPuzzle();
  text($("status"), message);
  text($("result"), ended && !flyer ? `You cleared ${game.state.player.cleared} tiles. ${rival().name} cleared ${game.state.rival.cleared}.` : "");
}
function clearInput() {
  keys.clear();
  target = null;
  anchor = null;
  if (drag && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
  drag = null;
}
function animate(now) {
  frame = 0;
  if (status() !== "playing") return;
  const delta = Math.min(now - lastTime, 100);
  lastTime = now;
  if (recipe.template === "flyer") {
    game.tick(delta / 1000, {
      x: Number(keys.has("arrowright") || keys.has("d")) - Number(keys.has("arrowleft") || keys.has("a")),
      y: Number(keys.has("arrowdown") || keys.has("s")) - Number(keys.has("arrowup") || keys.has("w")), target,
    });
  } else game.tick(delta);
  if (recipe.template === "flyer" || now - lastPaint >= 100 || status() !== "playing") {
    render(); lastPaint = now;
  }
  if (status() === "playing") frame = requestAnimationFrame(animate);
  else clearInput();
}
function run() {
  cancelAnimationFrame(frame);
  lastTime = performance.now();
  lastPaint = 0;
  frame = requestAnimationFrame(animate);
}
function pause() {
  if (!game) return;
  game.pause();
  cancelAnimationFrame(frame);
  frame = 0;
  clearInput();
  render();
}
function togglePause() {
  if (status() === "paused") {
    game.resume();
    clearInput();
    (recipe.template === "flyer" ? canvas : $("player-board")).focus({ preventScroll: true });
    run(); render();
  } else pause();
}
function resize() {
  if (!game || recipe.template !== "flyer") return;
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  clearInput();
  render();
}
function point(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * WIDTH / rect.width, y: (event.clientY - rect.top) * HEIGHT / rect.height };
}
canvas.addEventListener("pointerdown", event => {
  if (status() !== "playing" || drag || event.button !== 0) return;
  canvas.focus({ preventScroll: true });
  const at = point(event);
  drag = { id: event.pointerId, x: game.player.x - at.x, y: game.player.y - at.y };
  target = { x: game.player.x, y: game.player.y };
  keys.clear();
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", event => {
  if (drag?.id !== event.pointerId) return;
  const at = point(event);
  target = { x: at.x + drag.x, y: at.y + drag.y };
});
canvas.addEventListener("pointerup", event => { if (drag?.id === event.pointerId) clearInput(); });
canvas.addEventListener("pointercancel", event => { if (drag?.id === event.pointerId) pause(); });
canvas.addEventListener("lostpointercapture", () => { drag = null; target = null; });
canvas.addEventListener("blur", clearInput);
canvas.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();
  if (key === "p") { event.preventDefault(); if (!event.repeat) togglePause(); return; }
  if (!["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(key)) return;
  event.preventDefault();
  if (status() === "playing") { target = null; keys.add(key); }
});
$("player-board").addEventListener("keydown", event => {
  const key = event.key.toLowerCase();
  if (key === "p") { event.preventDefault(); if (!event.repeat) togglePause(); return; }
  if (!playable() || !["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "enter", "r"].includes(key)) return;
  event.preventDefault();
  anchor = null;
  if (key === "arrowup") cursor.row = Math.max(0, cursor.row - 1);
  else if (key === "arrowdown") cursor.row = Math.min(ROWS - 1, cursor.row + 1);
  else if (key === "arrowleft") cursor.col = Math.max(0, cursor.col - 1);
  else if (key === "arrowright") cursor.col = Math.min(COLS - 2, cursor.col + 1);
  else if (!event.repeat && key === "r") game.raise();
  else if (!event.repeat) game.swap(cursor.row, cursor.col);
  render();
});
window.addEventListener("keyup", event => keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", pause);
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(canvas);
window.addEventListener("pagehide", () => {
  pause();
  loadController?.abort();
  resizeObserver.disconnect();
});
window.addEventListener("pageshow", () => { resizeObserver.observe(canvas); resize(); render(); });
reduced.addEventListener("change", render);
$("start").addEventListener("click", () => {
  if (!game) return;
  clearInput();
  if (recipe.template === "flyer") game.reset();
  else { cursor.row = ROWS - 2; cursor.col = 2; game.start(); }
  (recipe.template === "flyer" ? canvas : $("player-board")).focus({ preventScroll: true });
  render(); run();
});
$("pause").addEventListener("click", togglePause);
$("raise").addEventListener("click", () => { if (playable()) { game.raise(); anchor = null; render(); } });
$("rival-choice").addEventListener("change", () => {
  if (!game || ["playing", "paused"].includes(status())) return;
  preparePuzzle(); render();
});
$("rules-toggle").addEventListener("click", () => {
  pause();
  $("rules").hidden = !$("rules").hidden;
  $("rules-toggle").setAttribute("aria-expanded", String(!$("rules").hidden));
});
$("roster-details").addEventListener("toggle", () => { if ($("roster-details").open) pause(); });
$("retry").addEventListener("click", load);
$("library-link").hidden = embedded;
$("preview-label").hidden = !preview;
if (preview) {
  if (!embedded) {
    $("loading").hidden = true;
    text($("error-message"), "Open a preview from the game editor, or choose a saved game from My games.");
    $("retry").hidden = true;
    $("error-panel").hidden = false;
  } else {
    text($("loading"), "Waiting for your game from the editor…");
    window.addEventListener("message", event => {
      if (previewAccepted || event.origin !== location.origin || event.source !== window.parent ||
          event.data?.type !== "game-creator-preview") return;
      previewAccepted = true;
      recipe = event.data.recipe;
      void load();
    });
    window.parent.postMessage({ type: "game-creator-ready" }, location.origin);
  }
} else void load();
