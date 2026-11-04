import { loadShell, say } from "./shell.js";
import { Flight3D } from "./ribbon-flight-3d-engine.js";

const $ = id => document.getElementById(id);
const canvas = $("sky");
const game = new Flight3D();
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const keys = new Set();
let scene = null;
let graphicsProblem = "";
let contextLost = false;
let drag = null;
let target = null;
let frame = 0;
let lastTime = 0;

function text(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function clearInput() {
  keys.clear();
  target = null;
  if (drag && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
  drag = null;
}

function syncUI() {
  const status = game.status;
  const unavailable = !scene || Boolean(graphicsProblem);
  $("start").hidden = status === "playing" || status === "paused";
  $("start").disabled = unavailable;
  text($("start"), status === "over" ? "Fly again" : "Start flying");
  $("pause").disabled = unavailable || status === "ready" || status === "over";
  text($("pause"), status === "paused" ? "Resume" : "Pause");
  text($("score"), String(game.score));
  text($("rings"), String(game.ringsCollected));
  text($("hearts"), Array.from({ length: 3 }, (_, i) => i < game.player.hearts ? "♥" : "♡").join(" "));
  $("hearts").setAttribute("aria-label", `${game.player.hearts} hearts left`);
  $("graphics-help").hidden = !graphicsProblem;
  text($("graphics-message"), graphicsProblem);
  $("overlay").hidden = !unavailable && status === "playing";
  if (unavailable) {
    text($("overlay-title"), graphicsProblem ? "The 3D sky is unavailable" : "Opening the sky…");
    text($("overlay-detail"), graphicsProblem ? "See the graphics help below." : "Loading local 3D graphics.");
    text($("flight-status"), graphicsProblem || "Loading 3D graphics.");
    return;
  }
  text($("overlay-title"), status === "paused" ? "Paused" : status === "over" ? "Nice flying!" : "Ready for 3D?");
  text($("overlay-detail"), status === "paused" ? "Your sky is safe. Tap Resume to keep going." :
    status === "over" ? `${game.score} points and ${game.ringsCollected} rings! Tap Fly again for a fresh flight.` :
      "Tap Start flying. Gold rings are good; dodge the rocks!");
  text($("flight-status"), status === "playing" ? `Keep flying! ${game.player.hearts} hearts left.` :
    status === "paused" ? "Paused. Tap Resume when you are ready." :
    status === "over" ? `Flight finished. ${game.score} points and ${game.ringsCollected} rings.` : "Tap Start flying when you are ready.");
}

function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
  clearInput();
}

function graphicsFailed(error) {
  game.pause();
  stop();
  graphicsProblem = "This browser could not start or draw the 3D game. It needs WebGL 2 graphics. Try reloading or updating the browser, or play the original Ribbon Flight.";
  console.error("Ribbon Flight 3D graphics:", error);
  syncUI();
}

function draw() {
  if (scene && !graphicsProblem) {
    try { scene.render(game, reduced.matches); }
    catch (error) { graphicsFailed(error); return; }
  }
  syncUI();
}

function resize() {
  clearInput();
  if (!scene || graphicsProblem) return;
  const rect = canvas.getBoundingClientRect();
  try { scene.resize(rect.width, rect.height); draw(); }
  catch (error) { graphicsFailed(error); }
}

function animate(now) {
  frame = 0;
  game.tick((now - lastTime) / 1000, {
    x: Number(keys.has("arrowright") || keys.has("d")) - Number(keys.has("arrowleft") || keys.has("a")),
    y: Number(keys.has("arrowup") || keys.has("w")) - Number(keys.has("arrowdown") || keys.has("s")),
    target,
  });
  lastTime = now;
  draw();
  if (game.status === "playing" && !graphicsProblem) frame = requestAnimationFrame(animate);
  else clearInput();
}

function run() {
  cancelAnimationFrame(frame);
  lastTime = performance.now();
  frame = requestAnimationFrame(animate);
}

function pause() {
  game.pause();
  stop();
  draw();
}

function togglePause() {
  if (!scene || graphicsProblem) return;
  if (game.status === "paused") { game.resume(); clearInput(); run(); draw(); }
  else if (game.status === "playing") pause();
}

function point(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width * 12, y: -(event.clientY - rect.top) / rect.height * 7 };
}

canvas.addEventListener("pointerdown", event => {
  if (game.status !== "playing" || graphicsProblem || drag || event.button !== 0) return;
  canvas.focus({ preventScroll: true });
  const at = point(event);
  drag = { id: event.pointerId, offsetX: game.player.x - at.x, offsetY: game.player.y - at.y };
  target = { x: game.player.x, y: game.player.y };
  keys.clear();
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", event => {
  if (!drag || event.pointerId !== drag.id) return;
  const at = point(event);
  target = { x: at.x + drag.offsetX, y: at.y + drag.offsetY };
});
canvas.addEventListener("pointerup", event => { if (drag?.id === event.pointerId) clearInput(); });
canvas.addEventListener("pointercancel", event => { if (drag?.id === event.pointerId) pause(); });
canvas.addEventListener("lostpointercapture", () => { drag = null; target = null; });
canvas.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();
  if (key === "p") { event.preventDefault(); if (!event.repeat) togglePause(); return; }
  if (!["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(key)) return;
  event.preventDefault();
  if (game.status === "playing" && !graphicsProblem) { target = null; keys.add(key); }
});
window.addEventListener("keyup", event => keys.delete(event.key.toLowerCase()));
canvas.addEventListener("blur", clearInput);
window.addEventListener("blur", pause);
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
window.addEventListener("pagehide", () => {
  pause();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
});
window.addEventListener("pageshow", draw);
reduced.addEventListener("change", draw);
canvas.addEventListener("webglcontextlost", event => {
  event.preventDefault();
  contextLost = true;
  game.pause();
  stop();
  graphicsProblem = "3D graphics were interrupted. Your flight is paused. If graphics do not return, reload or play the original game.";
  syncUI();
});
canvas.addEventListener("webglcontextrestored", () => {
  // Three's listener must rebuild its internal GPU state before we draw again.
  queueMicrotask(() => {
    if (!contextLost || !scene) return;
    contextLost = false;
    graphicsProblem = "";
    resize();
  });
});
$("start").onclick = () => {
  if (!scene || graphicsProblem) return;
  clearInput(); game.reset();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  canvas.focus({ preventScroll: true });
  run(); draw();
};
$("pause").onclick = togglePause;
$("reload").onclick = () => location.reload();
$("rules-btn").onclick = () => {
  pause();
  say("Ribbon Flight 3D! Fly forward into the sky. Drag to move left, right, up and down. Your ribbon tips shoot automatically. " +
    "Line up your aim guide with little flyers. Fly through the middle of gold rings for points. Dodge the big rocks: shots cannot break them. " +
    "You have three hearts and a short shield after a bump. Missed flyers and rings are okay. Tap Pause for a break. " +
    "With a keyboard, click the sky, then use arrows or W A S D. P pauses. Fly again starts a fresh flight.");
};
new ResizeObserver(resize).observe(canvas);
void loadShell("Ribbon Flight 3D");
try {
  const { FlightScene } = await import("./ribbon-flight-3d-scene.js");
  scene = new FlightScene(canvas);
  resize();
} catch (error) { graphicsFailed(error); }
