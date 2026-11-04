const STEP = 1 / 120;
const MAX_FRAME = 0.25;
const PLAYER_SPEED = 7.5;
const PLAYER_RADIUS = 0.45;
const SHOT_SPEED = 75;
const SHOT_RADIUS = 0.55;
const FIRE_INTERVAL = 0.24;
const SHIELD_SECONDS = 2;
const SPAWN_Z = -90;
const DESPAWN_Z = 8;
const CAPS = { enemies: 24, obstacles: 12, rings: 8, shots: 48 };
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const lerp = (a, b, t) => a + (b - a) * t;

// Return the first contact along a swept relative-motion segment, not just
// an overlap at its endpoint. Both the projectile and target may be moving.
function contactTime(shot, object, radius) {
  const x = shot.x - object.previousX;
  const y = shot.y - object.previousY;
  const z = shot.previousZ - object.previousZ;
  const dx = object.previousX - object.x;
  const dy = object.previousY - object.y;
  const dz = shot.z - shot.previousZ - (object.z - object.previousZ);
  const c = x * x + y * y + z * z - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy + dz * dz;
  if (a === 0) return Infinity;
  const b = x * dx + y * dy + z * dz;
  const discriminant = b * b - a * c;
  if (discriminant < 0) return Infinity;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t >= 0 && t <= 1 ? t : Infinity;
}

function compact(objects, minimumZ, maximumZ) {
  let count = 0;
  for (const object of objects) {
    if (!object.gone && object.z >= minimumZ && object.z <= maximumZ) {
      objects[count++] = object;
    }
  }
  objects.length = count;
}

// Browser-independent simulation. All distances are world units; all times
// are seconds. The renderer only reads these objects and never owns physics.
export class Flight3D {
  constructor(random = Math.random) {
    this.random = random;
    this.nextId = 1;
    this.reset();
    this.status = "ready";
  }

  reset() {
    this.status = "playing";
    this.player = { x: 0, y: 0, hearts: 3, shield: 0 };
    this.score = 0;
    this.ringsCollected = 0;
    this.elapsed = 0;
    this.spawned = 0;
    this.enemies = [];
    this.obstacles = [];
    this.rings = [];
    this.shots = [];
    this.remainder = 0;
    this.fireIn = 0;
    this.enemyIn = 2;
    this.obstacleIn = 5.5;
    this.ringIn = 4.5;
    // An immediately visible, safe first ring teaches the center-flight goal.
    this.addRing(0, 0, -36);
  }

  pause() {
    if (this.status === "playing") this.status = "paused";
  }

  resume() {
    if (this.status === "paused") this.status = "playing";
  }

  tick(seconds, input = {}) {
    if (this.status !== "playing" || !Number.isFinite(seconds) || seconds <= 0) return;
    // A backgrounded or stalled frame must not fast-forward through a life.
    // The controller also pauses on visibility changes.
    this.remainder += Math.min(seconds, MAX_FRAME);
    while (this.remainder + 1e-12 >= STEP && this.status === "playing") {
      this.remainder = Math.max(0, this.remainder - STEP);
      this.step(STEP, input);
    }
  }

  addRing(x, y, z = SPAWN_Z) {
    if (this.rings.length >= CAPS.rings) return;
    this.rings.push({ id: this.nextId++, x, y, z, radius: 1.5 });
    this.spawned += 1;
  }

  spawnEnemy() {
    if (this.enemies.length >= CAPS.enemies) return;
    const kind = Math.floor(this.random() * 3);
    const x = (this.random() * 2 - 1) * 5;
    const y = (this.random() * 2 - 1) * 2.5;
    this.enemies.push({
      id: this.nextId++, x, y, z: SPAWN_Z,
      radius: 0.7 + kind * 0.1, kind,
      baseX: x, baseY: y, age: 0,
      phase: this.random() * Math.PI * 2,
    });
    this.spawned += 1;
  }

  spawnObstacle() {
    if (this.obstacles.length >= CAPS.obstacles) return;
    this.obstacles.push({
      id: this.nextId++,
      x: (this.random() * 2 - 1) * 4.7,
      y: (this.random() * 2 - 1) * 2.1,
      z: SPAWN_Z,
      radius: 1.05 + this.random() * 0.35,
    });
    this.spawned += 1;
  }

  movePlayer(dt, input) {
    const p = this.player;
    const target = input.target;
    const targeting = target && Number.isFinite(target.x) && Number.isFinite(target.y);
    let dx = targeting ? clamp(target.x, -6, 6) - p.x :
      (Number.isFinite(input.x) ? clamp(input.x, -1, 1) : 0);
    let dy = targeting ? clamp(target.y, -3.5, 3.5) - p.y :
      (Number.isFinite(input.y) ? clamp(input.y, -1, 1) : 0);
    const distance = Math.hypot(dx, dy);
    if (!distance) return;
    const travel = PLAYER_SPEED * dt * (targeting ? 1 : Math.min(1, distance));
    const scale = (targeting ? Math.min(travel, distance) : travel) / distance;
    dx *= scale;
    dy *= scale;
    p.x = clamp(p.x + dx, -6, 6);
    p.y = clamp(p.y + dy, -3.5, 3.5);
  }

  advance(objects, distance, dt, flyers = false) {
    for (const object of objects) {
      object.previousX = object.x;
      object.previousY = object.y;
      object.previousZ = object.z;
      object.z += distance;
      if (flyers) {
        object.age += dt;
        // Subtract the initial wave value so a fresh flyer never jumps sideways.
        object.x = object.baseX + 0.4 * (Math.sin(object.age * 1.3 + object.phase) - Math.sin(object.phase));
        object.y = object.baseY + 0.3 * (Math.sin(object.age * 1.7 + object.phase) - Math.sin(object.phase));
      }
    }
  }

  fire() {
    if (this.shots.length + 2 > CAPS.shots) return;
    for (const offset of [-1.05, 1.05]) {
      this.shots.push({
        id: this.nextId++, x: this.player.x + offset, y: this.player.y + 0.18,
        z: -3.55, previousZ: -3.55,
      });
    }
  }

  advanceShots(dt) {
    for (const shot of this.shots) {
      shot.previousZ = shot.z;
      shot.z -= SHOT_SPEED * dt;
      let nearest = null;
      let nearestTime = Infinity;
      let isEnemy = false;
      // A rock absorbs the shot, but never breaks. Find the first contact
      // across both kinds, so array/spawn order cannot shoot through rocks.
      for (const obstacle of this.obstacles) {
        if (obstacle.previousZ >= 0) continue;
        const t = contactTime(shot, obstacle, obstacle.radius + SHOT_RADIUS);
        if (t < nearestTime && lerp(obstacle.previousZ, obstacle.z, t) <= 0) {
          nearest = obstacle;
          nearestTime = t;
        }
      }
      for (const enemy of this.enemies) {
        if (enemy.gone || enemy.previousZ >= 0) continue;
        const t = contactTime(shot, enemy, enemy.radius + SHOT_RADIUS);
        if (t < nearestTime && lerp(enemy.previousZ, enemy.z, t) <= 0) {
          nearest = enemy;
          nearestTime = t;
          isEnemy = true;
        }
      }
      if (!nearest) continue;
      shot.gone = true;
      if (isEnemy) {
        nearest.gone = true;
        this.score += 10;
      }
    }
  }

  crossingDistance(object, previousX, previousY) {
    if (object.gone || object.previousZ >= 0 || object.z < 0) return Infinity;
    const t = -object.previousZ / (object.z - object.previousZ);
    return Math.hypot(
      lerp(object.previousX, object.x, t) - lerp(previousX, this.player.x, t),
      lerp(object.previousY, object.y, t) - lerp(previousY, this.player.y, t),
    );
  }

  takeHit() {
    if (this.player.shield > 0 || this.status !== "playing") return;
    this.player.hearts -= 1;
    this.player.shield = SHIELD_SECONDS;
    if (this.player.hearts === 0) this.status = "over";
  }

  step(dt, input) {
    this.elapsed += dt;
    const p = this.player;
    const previousX = p.x;
    const previousY = p.y;
    p.shield = Math.max(0, p.shield - dt);
    this.movePlayer(dt, input);

    // All difficulty reaches its ceiling at three minutes and stays there.
    const difficulty = Math.min(1, this.elapsed / 180);
    const distance = (20 + 10 * difficulty) * dt;
    this.enemyIn -= dt;
    if (this.enemyIn <= 0) {
      this.spawnEnemy();
      this.enemyIn += 1.8 - 0.9 * difficulty;
    }
    this.obstacleIn -= dt;
    if (this.obstacleIn <= 0) {
      this.spawnObstacle();
      this.obstacleIn += 6 - 2.2 * difficulty;
    }
    this.ringIn -= dt;
    if (this.ringIn <= 0) {
      this.addRing((this.random() * 2 - 1) * 4.7, (this.random() * 2 - 1) * 2.1);
      this.ringIn += 4.5;
    }
    this.advance(this.enemies, distance, dt, true);
    this.advance(this.obstacles, distance, dt);
    this.advance(this.rings, distance, dt);
    this.fireIn -= dt;
    if (this.fireIn <= 0) {
      this.fire();
      this.fireIn += FIRE_INTERVAL;
    }
    this.advanceShots(dt);

    for (const ring of this.rings) {
      if (this.crossingDistance(ring, previousX, previousY) <= ring.radius - 0.2) {
        ring.gone = true;
        this.ringsCollected += 1;
        this.score += 25;
      }
    }
    // Hazards are checked exactly once, at the swept z=0 crossing. A passed
    // hazard can never hit from behind, even after the shield expires.
    for (const enemy of this.enemies) {
      if (this.crossingDistance(enemy, previousX, previousY) <= enemy.radius + PLAYER_RADIUS) {
        this.takeHit();
      }
    }
    for (const obstacle of this.obstacles) {
      if (this.crossingDistance(obstacle, previousX, previousY) <= obstacle.radius + PLAYER_RADIUS) {
        this.takeHit();
      }
    }
    compact(this.enemies, -Infinity, DESPAWN_Z);
    compact(this.obstacles, -Infinity, DESPAWN_Z);
    compact(this.rings, -Infinity, DESPAWN_Z);
    compact(this.shots, -105, 0);
  }
}
