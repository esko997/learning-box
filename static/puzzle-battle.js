import { loadShell, say } from "./shell.js";
import { PuzzleBattle, COLS, ROWS } from "./puzzle-battle-engine.js";

const $ = id => document.getElementById(id);
const SYMBOLS = ["●", "◆", "★", "▲", "♥"];
const NAMES = ["blue circle", "orange diamond", "yellow star", "green triangle", "purple heart"];
const game = new PuzzleBattle();
const cursor = { row: ROWS - 2, col: 2 };
let anchor = null;
let previousCells = [];
let clock = null;
let lastTick = 0;
let previousStatus = "ready";

function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

const cells = {};
const previews = {};
for (const side of ["player", "rival"]) {
  cells[side] = Array.from({ length: ROWS * COLS }, (_, index) => {
    const cell = document.createElement(side === "player" ? "button" : "div");
    cell.className = "tile";
    if (side === "player") {
      cell.type = "button";
      cell.tabIndex = -1;
      cell.onclick = () => selectCell(index);
    } else cell.setAttribute("aria-hidden", "true");
    return cell;
  });
  $(`${side}-board`).replaceChildren(...cells[side]);
  previews[side] = Array.from({ length: COLS }, () => {
    const cell = document.createElement("span");
    cell.className = "tile";
    cell.setAttribute("aria-hidden", "true");
    return cell;
  });
  $(`${side}-next`).replaceChildren(...previews[side]);
}

function playable() {
  return game.state.status === "playing" && game.state.player.phase === "idle";
}

function selectCell(index) {
  if (!playable()) return;
  const row = Math.floor(index / COLS), col = index % COLS;
  if (anchor !== null && Math.floor(anchor / COLS) === row && Math.abs(anchor - index) === 1) {
    cursor.row = row;
    cursor.col = Math.min(anchor % COLS, col);
    game.swap(row, cursor.col);
    anchor = null;
  } else {
    anchor = index;
    cursor.row = row;
    cursor.col = Math.min(col, COLS - 2);
  }
  render();
}

function paintTile(cell, kind) {
  const value = kind === null ? "empty" : String(kind);
  if (cell.dataset.kind !== value) {
    cell.dataset.kind = value;
    setText(cell, kind === null ? "" : SYMBOLS[kind]);
  }
}

function render() {
  const state = game.state;
  if (state.player.cells.some((kind, index) => kind !== previousCells[index])) anchor = null;
  previousCells = state.player.cells.slice();
  for (const side of ["player", "rival"]) {
    const board = state[side];
    const clearing = new Set(board.matches);
    cells[side].forEach((cell, index) => {
      paintTile(cell, board.cells[index]);
      cell.classList.toggle("clearing", clearing.has(index));
      if (side === "player") {
        const selected = anchor !== null ? index === anchor :
          Math.floor(index / COLS) === cursor.row && (index % COLS === cursor.col || index % COLS === cursor.col + 1);
        cell.classList.toggle("selected", selected && playable());
        cell.disabled = !playable();
        cell.setAttribute("aria-label", `Row ${Math.floor(index / COLS) + 1}, column ${index % COLS + 1}: ${board.cells[index] === null ? "empty" : NAMES[board.cells[index]]}`);
        cell.setAttribute("aria-pressed", String(selected && playable()));
      }
    });
    previews[side].forEach((cell, index) => paintTile(cell, board.nextRow[index]));
    setText($(`${side}-score`), `${board.score} · ${board.cleared} cleared`);
    setText($(`${side}-message`), board.pendingRows ? `${board.pendingRows} incoming row${board.pendingRows === 1 ? "" : "s"}! ${board.message}` : board.message || "Match 3 or more");
    const danger = board.cells.slice(0, COLS).some(kind => kind !== null);
    $(`${side}-board`).closest(".well").classList.toggle("danger", danger);
    setText($(`${side}-danger`), danger ? `Clear the top! ${Math.max(0, Math.ceil((5000 - board.dangerMs) / 1000))} seconds` : "Keep below the top");
    document.querySelector(`.${side}-creature`).classList.toggle("worried", danger && state.status === "playing");
    document.querySelector(`.${side}-creature`).classList.toggle("celebrate", board.phase === "clear" || state.status === (side === "player" ? "won" : "lost"));
  }
  $("player-board").setAttribute("aria-label", `Your puzzle board. Cursor row ${cursor.row + 1}, columns ${cursor.col + 1} and ${cursor.col + 2}. Use arrows and Space to swap.`);
  $("rival-board").setAttribute("aria-label", `Starfin's puzzle board. ${state.rival.cleared} blocks cleared.`);
  const ended = ["won", "lost", "draw"].includes(state.status);
  $("start").hidden = state.status === "playing" || state.status === "paused";
  setText($("start"), ended ? "Play again" : "Start battle");
  $("pause").disabled = !["playing", "paused"].includes(state.status);
  setText($("pause"), state.status === "paused" ? "Resume" : "Pause");
  $("raise").disabled = !playable();
  let message = "Ready? Match blocks and help Bluewing!";
  if (state.status === "playing") message = anchor === null ? "Tap two neighbors in the same row to swap." : "Now tap the block just to its left or right.";
  if (state.status === "paused") message = "Paused. Both boards are safe. Tap Resume when you're ready.";
  if (state.status === "won") message = "Bluewing wins! Starfin's stack reached the top.";
  if (state.status === "lost") message = "Starfin wins this time. Let's try again!";
  if (state.status === "draw") message = "Both stacks reached the top. It's a draw!";
  setText($("battle-status"), message);
  setText($("result"), ended ? `You cleared ${state.player.cleared} blocks. Starfin cleared ${state.rival.cleared}.` : "");
  if (ended) {
    stopClock();
    if (previousStatus !== state.status) say(message);
  }
  previousStatus = state.status;
}

function stopClock() {
  clearInterval(clock);
  clock = null;
}

function runClock() {
  stopClock();
  lastTick = performance.now();
  clock = setInterval(() => {
    const now = performance.now();
    // A stalled or backgrounded browser must not jump the stacks forward on return.
    game.tick(Math.min(now - lastTick, 250));
    lastTick = now;
    render();
  }, 100);
}

function pause() {
  if (game.state.status !== "playing") return;
  game.pause();
  stopClock();
  anchor = null;
  render();
}

function togglePause() {
  if (game.state.status === "paused") {
    game.resume();
    runClock();
    render();
  } else pause();
}

$("start").onclick = () => {
  game.start();
  cursor.row = ROWS - 2;
  cursor.col = 2;
  anchor = null;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  render();
  runClock();
};
$("pause").onclick = togglePause;
$("raise").onclick = () => { game.raise(); anchor = null; render(); };
$("rules-btn").onclick = () => {
  pause();
  say("Creature Puzzle Battle! You help Bluewing on the left. Starfin plays on the right. " +
    "Tap a block, then its neighbor in the same row to swap them. Match three or more of the same shape across or down. " +
    "Blocks fall when a match disappears. Match four, or make a chain, to send an extra row to Starfin. " +
    "The stacks slowly rise. Clear blocks before they stay at the top too long. Raise row brings more blocks when you want them. " +
    "You can pause any time. On a keyboard, use arrows and Space to swap.");
};
$("player-board").addEventListener("keydown", event => {
  if (event.key.toLowerCase() === "p") { event.preventDefault(); if (!event.repeat) togglePause(); return; }
  if (!playable()) return;
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Enter", "r", "R"].includes(event.key)) return;
  event.preventDefault();
  anchor = null;
  if (event.key === "ArrowUp") cursor.row = Math.max(0, cursor.row - 1);
  else if (event.key === "ArrowDown") cursor.row = Math.min(ROWS - 1, cursor.row + 1);
  else if (event.key === "ArrowLeft") cursor.col = Math.max(0, cursor.col - 1);
  else if (event.key === "ArrowRight") cursor.col = Math.min(COLS - 2, cursor.col + 1);
  else if (!event.repeat && event.key.toLowerCase() === "r") game.raise();
  else if (!event.repeat) game.swap(cursor.row, cursor.col);
  render();
});
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
window.addEventListener("pagehide", () => {
  pause();
  stopClock();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
});
window.addEventListener("pageshow", () => render());
render();
void loadShell("Creature Puzzle Battle");
