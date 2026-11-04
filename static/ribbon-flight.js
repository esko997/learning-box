import { loadShell, say } from "./shell.js";
import { RibbonFlight, WIDTH, HEIGHT } from "./ribbon-flight-engine.js";

const $ = id => document.getElementById(id);
const canvas = $("sky");
const ctx = canvas.getContext("2d");
const game = new RibbonFlight();
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const keys = new Set();
const colors = ["#af8bd5", "#84cdaa", "#ffbe75"];
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
  $("start").hidden = status === "playing" || status === "paused";
  text($("start"), status === "over" ? "Fly again" : "Start flying");
  $("pause").disabled = status === "ready" || status === "over";
  text($("pause"), status === "paused" ? "Resume" : "Pause");
  text($("score"), String(game.score));
  text($("hearts"), Array.from({ length: 3 }, (_, i) => i < game.player.hearts ? "♥" : "♡").join(" "));
  $("hearts").setAttribute("aria-label", `${game.player.hearts} hearts left`);
  $("overlay").hidden = status === "playing";
  const title = status === "paused" ? "Paused" : status === "over" ? "Nice flying!" : "Ready to fly?";
  text($("overlay-title"), title);
  text($("overlay-detail"), status === "paused" ? "Your sky is safe. Tap Resume to keep going." :
    status === "over" ? `You scored ${game.score} points. Tap Fly again for another flight.` : "Tap Start flying, then drag in the sky.");
  text($("flight-status"), status === "playing" ? `Keep flying! ${game.player.hearts} hearts left.` :
    status === "paused" ? "Paused. Tap Resume when you are ready." :
    status === "over" ? `Flight finished. You scored ${game.score} points.` : "Tap Start flying when you are ready.");
}

function line(points, color, width = 4) {
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function oval(x, y, rx, ry, fill, stroke = "#245678", width = 3) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}

function drawPlayer() {
  const p = game.player;
  const wave = reduced.matches ? 0 : Math.sin(game.elapsed * 7) * 3;
  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.shield > 0) {
    oval(0, 0, 29, 29, "#d0f5ff88", "#419bdd", 3);
  }
  // The drawing's blue face, thin feelers, and two red/blue ribbon arms.
  for (const side of [-1, 1]) {
    for (const [offset, color] of [[-4, "#e84b3b"], [5, "#243d94"]]) {
      ctx.beginPath();
      ctx.moveTo(15, side * 10 + offset);
      ctx.bezierCurveTo(44, side * (36 + wave) + offset, 78, side * 32 + offset, 100, side * 24 + offset);
      ctx.strokeStyle = color;
      ctx.lineWidth = 8;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(94, side * 24 - 8);
    ctx.lineTo(111, side * 24);
    ctx.lineTo(94, side * 24 + 8);
    ctx.closePath();
    ctx.fillStyle = "#fff9ed";
    ctx.fill();
    ctx.strokeStyle = "#c93732";
    ctx.lineWidth = 3;
    ctx.stroke();
    oval(100, side * 24, 2, 2, "#c93732", null);
  }
  line([-14, -10, -33, -19, -43, -18], "#2589b9", 4);
  line([0, -19, 7, -42], "#2589b9", 4);
  line([-3, 19, -5, 43], "#2589b9", 4);
  line([13, 14, 29, 33], "#2589b9", 4);
  oval(0, 0, 21, 24, "#d4f0fa", "#2589b9", 4);
  for (const x of [-8, 7]) {
    ctx.beginPath(); ctx.arc(x, -4, 5, Math.PI, 0);
    ctx.strokeStyle = "#24749a"; ctx.lineWidth = 4; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0, 4, 8, 0.15, Math.PI - 0.15);
  ctx.strokeStyle = "#24749a"; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
}

function drawEnemy(enemy) {
  const { x, y, radius: r, kind } = enemy;
  const flap = reduced.matches ? 0 : Math.sin(enemy.age * 10) * 5;
  oval(x - 10, y - 19 - flap, 13, 9, "#ffffff", "#3b587d", 2);
  oval(x + 10, y - 19 + flap, 13, 9, "#ffffff", "#3b587d", 2);
  oval(x, y, r, r * 0.85, colors[kind], "#3b587d", 3);
  for (const offset of [-8, 6]) {
    oval(x + offset, y - 3, 5, 7, "white", null);
    oval(x + offset - 2, y - 3, 2, 3, "#243d67", null);
  }
  line([x - 6, y + 9, x, y + 11, x + 5, y + 8], "#3b587d", 2);
}

function draw() {
  ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.fillStyle = "#fff9ed";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const scroll = reduced.matches ? 0 : game.elapsed * 32;
  ctx.strokeStyle = "#d7e9ed";
  ctx.lineWidth = 1;
  for (let y = 30; y < HEIGHT; y += 30) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); ctx.stroke();
  }
  for (let i = 0; i < 7; i++) {
    const x = ((i * 193 - scroll) % 1300 + 1300) % 1300 - 120;
    const y = 55 + (i * 137) % 430;
    oval(x, y, 42, 13, "#e2f0f4", null);
    oval(x - 15, y - 9, 19, 16, "#e2f0f4", null);
    oval(x + 10, y - 12, 24, 18, "#e2f0f4", null);
  }
  for (const shot of game.shots) {
    line([shot.x - 11, shot.y, shot.x + 4, shot.y], "#df4939", 6);
    line([shot.x - 13, shot.y + 4, shot.x, shot.y + 4], "#274d9a", 3);
  }
  for (const enemy of game.enemies) drawEnemy(enemy);
  for (const pop of game.pops) {
    if (reduced.matches) continue;
    const radius = (1 - pop.life / 0.28) * 34;
    ctx.globalAlpha = pop.life / 0.28;
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      oval(pop.x + Math.cos(angle) * radius, pop.y + Math.sin(angle) * radius, 4, 4, colors[pop.kind], null);
    }
    ctx.globalAlpha = 1;
  }
  drawPlayer();
  if (game.status === "ready") {
    for (let i = 0; i < 3; i++) drawEnemy({ x: 700 + i * 65, y: 180 + i * 90, radius: 24, kind: i, age: 0 });
  }
  syncUI();
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  clearInput();
  draw();
}

function animate(now) {
  frame = 0;
  const input = {
    x: Number(keys.has("arrowright") || keys.has("d")) - Number(keys.has("arrowleft") || keys.has("a")),
    y: Number(keys.has("arrowdown") || keys.has("s")) - Number(keys.has("arrowup") || keys.has("w")),
    target,
  };
  game.tick((now - lastTime) / 1000, input);
  lastTime = now;
  draw();
  if (game.status === "playing") frame = requestAnimationFrame(animate);
  else clearInput();
}

function run() {
  cancelAnimationFrame(frame);
  lastTime = performance.now();
  frame = requestAnimationFrame(animate);
}

function pause() {
  game.pause();
  cancelAnimationFrame(frame);
  frame = 0;
  clearInput();
  draw();
}

function togglePause() {
  if (game.status === "paused") { game.resume(); clearInput(); run(); draw(); }
  else if (game.status === "playing") pause();
}

function point(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * WIDTH / rect.width, y: (event.clientY - rect.top) * HEIGHT / rect.height };
}

canvas.addEventListener("pointerdown", event => {
  if (game.status !== "playing" || drag || event.button !== 0) return;
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
  if (game.status === "playing") { target = null; keys.add(key); }
});
window.addEventListener("keyup", event => keys.delete(event.key.toLowerCase()));
canvas.addEventListener("blur", clearInput);
window.addEventListener("blur", pause);
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
window.addEventListener("pagehide", () => { pause(); if ("speechSynthesis" in window) speechSynthesis.cancel(); });
window.addEventListener("pageshow", draw);
reduced.addEventListener("change", draw);
$("start").onclick = () => {
  clearInput(); game.reset();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  canvas.focus({ preventScroll: true });
  run(); draw();
};
$("pause").onclick = togglePause;
$("rules-btn").onclick = () => {
  pause();
  say("Ribbon Flight! Drag anywhere in the sky to move your blue flyer. The ribbon tips shoot by themselves. " +
    "Little flyers keep coming from the right. Pop them for points, and dodge them with your blue face. " +
    "Your long ribbon arms are safe to touch. Flyers that pass you are okay. You have three hearts. " +
    "Tap Pause for a break, or Fly again after your flight. With a keyboard, use arrows or W A S D, and P to pause.");
};
new ResizeObserver(resize).observe(canvas);
resize();
void loadShell("Ribbon Flight");
