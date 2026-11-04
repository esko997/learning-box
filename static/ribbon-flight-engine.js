export const WIDTH = 960;
export const HEIGHT = 540;
export const FACE_RADIUS = 18;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Fixed simulation steps keep movement and collisions independent of display refresh.
export class RibbonFlight {
  constructor(random = Math.random, options = {}) {
    this.random = random;
    this.enemyTypes = options.enemyTypes?.length ? options.enemyTypes : null;
    this.pacing = options.pacing ?? 1;
    this.speedScale = options.speedScale ?? 1;
    this.shotOffsetX = options.shotOffsetX ?? 100;
    this.reset("ready");
  }

  reset(status = "playing") {
    this.status = status;
    this.player = { x: 120, y: HEIGHT / 2, hearts: 3, shield: 0 };
    this.enemies = [];
    this.shots = [];
    this.pops = [];
    this.score = 0;
    this.elapsed = 0;
    this.spawned = 0;
    this.spawnIn = 0.7;
    this.fireIn = 0;
    this.remainder = 0;
  }

  pause() { if (this.status === "playing") this.status = "paused"; }
  resume() { if (this.status === "paused") this.status = "playing"; }

  tick(seconds, input = {}) {
    if (this.status !== "playing" || !Number.isFinite(seconds) || seconds <= 0) return;
    // A stalled frame is not permission to teleport enemies through the player.
    this.remainder += Math.min(seconds, 0.1);
    while (this.remainder >= 1 / 120 && this.status === "playing") {
      this.step(1 / 120, input);
      this.remainder -= 1 / 120;
    }
  }

  step(dt, input) {
    this.elapsed += dt;
    const p = this.player;
    p.shield = Math.max(0, p.shield - dt);
    let dx = input.x || 0, dy = input.y || 0;
    if (input.target) {
      dx = input.target.x - p.x;
      dy = input.target.y - p.y;
    }
    const distance = Math.hypot(dx, dy);
    if (distance) {
      const travel = input.target ? Math.min(distance, 330 * dt) : 330 * dt;
      p.x = clamp(p.x + dx / distance * travel, 34, WIDTH * 0.55);
      p.y = clamp(p.y + dy / distance * travel, 55, HEIGHT - 55);
    }

    this.fireIn -= dt;
    if (this.fireIn <= 0) {
      this.fireIn += 0.24;
      for (const offset of [-24, 24]) this.shots.push({ x: p.x + this.shotOffsetX, y: p.y + offset });
    }
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      this.spawnIn += Math.max(0.55, 1.45 - this.elapsed * 0.004) / this.pacing;
      const kind = this.enemyTypes ? this.spawned % this.enemyTypes.length : Math.floor(this.random() * 3);
      const type = this.enemyTypes?.[kind];
      const baseY = 70 + this.random() * (HEIGHT - 140);
      this.enemies.push({ x: WIDTH + 34, y: baseY, baseY, age: 0,
        speed: (105 + Math.min(100, this.elapsed * 0.35) + this.random() * 25) *
          this.speedScale * (type?.speed ?? 1),
        radius: this.enemyTypes ? 25 : 21 + kind * 2, kind,
        behavior: type?.behavior, phase: this.random() * Math.PI * 2 });
      this.spawned += 1;
    }
    for (const enemy of this.enemies) {
      enemy.x -= enemy.speed * dt;
      enemy.age += dt;
      if (enemy.behavior === "straight") enemy.y = enemy.baseY;
      else if (enemy.behavior === "chase") {
        enemy.y = clamp(enemy.y + clamp(p.y - enemy.y, -enemy.speed * 0.42 * dt,
          enemy.speed * 0.42 * dt), 40, HEIGHT - 40);
      } else {
        enemy.y = enemy.baseY + Math.sin(enemy.age * 2 + enemy.phase) *
          (enemy.behavior === "weave" ? 42 : 12 + enemy.kind * 8);
      }
    }
    for (const shot of this.shots) {
      shot.x += 610 * dt;
      for (const enemy of this.enemies) {
        if (enemy.gone || Math.hypot(shot.x - enemy.x, shot.y - enemy.y) > enemy.radius + 7) continue;
        enemy.gone = true;
        shot.gone = true;
        this.score += 10;
        this.pops.push({ x: enemy.x, y: enemy.y, life: 0.28, kind: enemy.kind });
        break;
      }
    }
    for (const enemy of this.enemies) {
      if (enemy.gone || p.shield > 0 || Math.hypot(p.x - enemy.x, p.y - enemy.y) >= FACE_RADIUS + enemy.radius) continue;
      enemy.gone = true;
      p.hearts -= 1;
      p.shield = 1.8;
      if (!p.hearts) { this.status = "over"; break; }
    }
    for (const pop of this.pops) pop.life -= dt;
    this.shots = this.shots.filter(shot => !shot.gone && shot.x < WIDTH + 20);
    this.enemies = this.enemies.filter(enemy => !enemy.gone && enemy.x > -50);
    this.pops = this.pops.filter(pop => pop.life > 0);
  }
}
