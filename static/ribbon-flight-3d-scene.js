import * as THREE from "./vendor/three/three.module.min.js";

const SKY = 0xbfe9f4;
const TAU = Math.PI * 2;
const FORWARD = new THREE.Vector3(0, 1, 0);

/** A presentation-only scene. All motion and lifetime come from the engine clock. */
export class FlightScene {
  constructor(canvas) {
    // Three r180 requires WebGL 2. Let construction fail so the controller can
    // offer its accessible fallback rather than pretending the game is running.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(SKY);
    this.renderer.shadowMap.enabled = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 38, 115);
    this.camera = new THREE.PerspectiveCamera(52, 1.5, 0.1, 170);
    this.camera.position.set(0, 3.4, 16);
    this.camera.lookAt(0, 0, -35);
    this.disposed = false;
    this.ids = new Set();
    this.matrixObject = new THREE.Object3D();
    this.lastTime = 0;
    this.lastX = 0;
    this.bank = 0;

    // Each geometry/material is allocated once, including for replayed rounds.
    this.geometry = {
      ball: new THREE.SphereGeometry(1, 12, 8),
      pebble: new THREE.IcosahedronGeometry(1, 0),
      rock: new THREE.DodecahedronGeometry(1, 0),
      box: new THREE.BoxGeometry(1, 1, 1),
      rod: new THREE.CylinderGeometry(1, 1, 1, 6),
      tip: new THREE.ConeGeometry(1, 1, 3),
      hill: new THREE.ConeGeometry(1, 1, 5),
      ring: new THREE.TorusGeometry(1, 0.085, 6, 32),
      aim: new THREE.TorusGeometry(1, 0.035, 4, 24),
      smile: new THREE.TorusGeometry(0.2, 0.025, 4, 12, Math.PI),
      plane: new THREE.PlaneGeometry(1, 1),
    };
    const matte = color => new THREE.MeshLambertMaterial({ color, flatShading: true });
    const ink = color => new THREE.MeshBasicMaterial({ color });
    this.material = {
      blue: matte(0x359bc8),
      face: matte(0xc8f0fc),
      red: matte(0xec4e48),
      navy: matte(0x293e8f),
      white: matte(0xfffcf0),
      eyes: ink(0x173f63),
      purple: matte(0xb08ae2),
      mint: matte(0x70cdb1),
      peach: matte(0xffb75f),
      rock: matte(0x8b7f9e),
      rockLight: matte(0xb0a5bb),
      gold: new THREE.MeshLambertMaterial({ color: 0xffc940, emissive: 0x6b3900, flatShading: true }),
      glow: ink(0xfff4ad),
      shot: ink(0xff6952),
      shotCore: ink(0xffffeb),
      grass: matte(0x8acfa4),
      hill: matte(0x6ab7a3),
      hillLight: matte(0x9dd9b2),
      river: matte(0x72c9df),
      cloud: matte(0xf4fbff),
      route: ink(0xc1f0dc),
      aim: new THREE.MeshBasicMaterial({ color: 0x176885, transparent: true, opacity: 0.8, depthWrite: false }),
      shield: new THREE.MeshBasicMaterial({ color: 0x83dfff, transparent: true, opacity: 0.18, depthWrite: false }),
    };
    this.flyerColors = [this.material.purple, this.material.mint, this.material.peach];
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6689a7, 2.2));
    const sun = new THREE.DirectionalLight(0xfff2d6, 2.5);
    sun.position.set(-12, 20, 12);
    this.scene.add(sun);
    this._makeScenery();
    this._makePlayer();
    this._makeAim();
    this.flyers = this._pool(() => this._makeFlyer());
    this.rocks = this._pool(() => this._makeRock());
    this.rings = this._pool(() => this._makeRing());
    this.shots = this._pool(() => this._makeShot());
    this.resize(canvas.clientWidth || 960, canvas.clientHeight || 540);
  }

  _mesh(parent, geometry, material, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    parent.add(mesh);
    return mesh;
  }

  _rod(parent, from, to, width, material) {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    const direction = end.sub(start);
    const rod = this._mesh(parent, this.geometry.rod, material);
    rod.position.copy(start).addScaledVector(direction, 0.5);
    rod.scale.set(width, direction.length(), width);
    rod.quaternion.setFromUnitVectors(FORWARD, direction.normalize());
    return rod;
  }

  _makePlayer() {
    const g = this.geometry;
    const m = this.material;
    this.player = new THREE.Group();
    this.scene.add(this.player);
    this._mesh(this.player, g.ball, m.blue, 0, 0, 0, 0.72, 0.78, 0.59);
    this._mesh(this.player, g.ball, m.face, 0, 0, 0.33, 0.58, 0.62, 0.32);
    for (const side of [-1, 1]) {
      this._mesh(this.player, g.ball, m.eyes, side * 0.21, 0.15, 0.63, 0.075, 0.11, 0.035);
      this._mesh(this.player, g.ball, m.white, side * 0.21 - 0.015, 0.18, 0.66, 0.021);
      this._rod(this.player, [side * 0.38, 0.6, 0], [side * 0.63, 1.06, -0.08], 0.035, m.blue);
      this._mesh(this.player, g.ball, m.blue, side * 0.63, 1.06, -0.08, 0.065);
      this._rod(this.player, [side * 0.56, -0.3, 0], [side * 0.91, -0.62, -0.1], 0.03, m.blue);
    }
    const smile = this._mesh(this.player, g.smile, m.eyes, 0, -0.08, 0.656);
    smile.rotation.z = Math.PI;
    this.arms = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      this.player.add(arm);
      this.arms.push(arm);
      // Two long, contrasting strips on each arm echo the red/navy drawing.
      for (const [offset, material] of [[-0.085, m.red], [0.085, m.navy]]) {
        const points = [
          [side * 0.46, -0.06 + offset, -0.12],
          [side * 1.06, -0.1 + offset, -1.05],
          [side * 1.29, 0.04 + offset, -2.18],
          [side * 1.05, 0.18 + offset, -3.25],
        ];
        for (let i = 1; i < points.length; i++) {
          this._rod(arm, points[i - 1], points[i], 0.085, material);
        }
      }
      const tip = this._mesh(arm, g.tip, m.red, side * 1.05, 0.18, -3.55, 0.33, 0.73, 0.19);
      tip.rotation.x = -Math.PI / 2;
      this._mesh(arm, g.ball, m.white, side * 1.05, 0.3, -3.44, 0.07);
    }
    this.shield = this._mesh(this.player, g.ball, m.shield, 0, 0, 0, 1.07, 1.18, 0.86);
    this.shield.visible = false;
  }

  _makeAim() {
    this.aim = new THREE.Group();
    this.scene.add(this.aim);
    this._mesh(this.aim, this.geometry.aim, this.material.aim, 0, 0, -25, 0.62);
    for (const side of [-1, 1]) {
      this._mesh(this.aim, this.geometry.box, this.material.aim, side * 0.82, 0, -25, 0.24, 0.045, 0.045);
      this._mesh(this.aim, this.geometry.box, this.material.aim, 0, side * 0.82, -25, 0.045, 0.24, 0.045);
    }
    // Depth-spaced beads make the firing line readable without a screen HUD.
    for (const z of [-7, -12, -18]) {
      this._mesh(this.aim, this.geometry.ball, this.material.aim, 0, 0, z, 0.045);
    }
  }

  _instances(geometry, material, count) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instances wrap in depth; a stale cached bounding sphere must not hide them.
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  _makeScenery() {
    const ground = this._mesh(this.scene, this.geometry.plane, this.material.grass, 0, -5.8, -55, 230, 250, 1);
    ground.rotation.x = -Math.PI / 2;
    const river = this._mesh(this.scene, this.geometry.plane, this.material.river, 0, -5.77, -55, 13.8, 250, 1);
    river.rotation.x = -Math.PI / 2;
    this.hills = this._instances(this.geometry.hill, this.material.hill, 24);
    this.hillCaps = this._instances(this.geometry.hill, this.material.hillLight, 24);
    this.clouds = this._instances(this.geometry.ball, this.material.cloud, 36);
    this.route = this._instances(this.geometry.box, this.material.route, 24);
    this._updateScenery(0);
  }

  _instance(mesh, index, x, y, z, sx, sy, sz, rotation = 0) {
    const object = this.matrixObject;
    object.position.set(x, y, z);
    object.rotation.set(0, rotation, 0);
    object.scale.set(sx, sy, sz);
    object.updateMatrix();
    mesh.setMatrixAt(index, object.matrix);
  }

  _updateScenery(time) {
    const travel = time * 18;
    for (let i = 0; i < 24; i++) {
      const side = i % 2 ? 1 : -1;
      const z = ((i >> 1) * 11 + travel) % 132 - 119;
      const x = side * (12 + (i * 7) % 17);
      const height = 5 + (i * 3) % 9;
      this._instance(this.hills, i, x, -5.8 + height / 2, z, 5 + i % 4, height, 7, i * 0.7);
      this._instance(this.hillCaps, i, x, -5.8 + height * 0.77, z, (5 + i % 4) * 0.47, height * 0.47, 7 * 0.47, i * 0.7);
      this._instance(this.route, i, side * 6.9, -5.72, z, 0.13, 0.035, 3.4);
    }
    for (let i = 0; i < 36; i++) {
      const cluster = Math.floor(i / 3);
      const lobe = i % 3;
      const side = cluster % 2 ? 1 : -1;
      const z = (cluster * 13 + travel * 0.62) % 150 - 135;
      this._instance(this.clouds, i, side * (13 + cluster % 4 * 5) + (lobe - 1) * 2.3,
        8 + cluster % 3 * 2 + (lobe === 1 ? 0.6 : 0), z, 3.2, 1.05 + (lobe === 1 ? 0.5 : 0), 1.8);
    }
    this.hills.instanceMatrix.needsUpdate = true;
    this.hillCaps.instanceMatrix.needsUpdate = true;
    this.clouds.instanceMatrix.needsUpdate = true;
    this.route.instanceMatrix.needsUpdate = true;
  }

  _pool(create) {
    return { active: new Map(), spare: [], create };
  }

  _makeFlyer() {
    const node = new THREE.Group();
    node.userData.body = this._mesh(node, this.geometry.ball, this.material.purple, 0, 0, 0, 0.88, 0.7, 0.73);
    node.userData.wings = [];
    for (const side of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(side * 0.48, 0.26, 0);
      node.add(wing);
      this._mesh(wing, this.geometry.pebble, this.material.white, side * 0.49, 0.16, -0.06, 0.77, 0.16, 0.45);
      node.userData.wings.push(wing);
      this._mesh(node, this.geometry.ball, this.material.white, side * 0.29, 0.12, 0.62, 0.19, 0.24, 0.12);
      this._mesh(node, this.geometry.ball, this.material.eyes, side * 0.29, 0.1, 0.73, 0.075, 0.1, 0.035);
    }
    this._mesh(node, this.geometry.tip, this.material.peach, 0, -0.17, 0.76, 0.13, 0.22, 0.12).rotation.x = Math.PI / 2;
    return node;
  }

  _makeRock() {
    const node = new THREE.Group();
    this._mesh(node, this.geometry.rock, this.material.rock);
    // Fixed facet accents distinguish solid obstacles from flapping creatures.
    this._mesh(node, this.geometry.pebble, this.material.rockLight, -0.37, 0.33, 0.51, 0.35, 0.26, 0.17);
    this._mesh(node, this.geometry.pebble, this.material.rockLight, 0.42, -0.12, 0.65, 0.2, 0.32, 0.12);
    return node;
  }

  _makeRing() {
    const node = new THREE.Group();
    this._mesh(node, this.geometry.ring, this.material.gold);
    for (let i = 0; i < 4; i++) {
      const angle = i * TAU / 4;
      this._mesh(node, this.geometry.pebble, this.material.glow, Math.cos(angle), Math.sin(angle), 0, 0.12);
    }
    return node;
  }

  _makeShot() {
    const node = new THREE.Group();
    this._mesh(node, this.geometry.ball, this.material.shot, 0, 0, 0, 0.105, 0.105, 0.65);
    this._mesh(node, this.geometry.ball, this.material.shotCore, 0, 0, 0.1, 0.05, 0.05, 0.6);
    return node;
  }

  _syncEntities(items, pool, update, time, reducedMotion) {
    this.ids.clear();
    for (const item of items) this.ids.add(item.id);
    // Reclaim before acquiring: even an entirely new round reuses old meshes.
    for (const [id, node] of pool.active) {
      if (this.ids.has(id)) continue;
      node.visible = false;
      pool.active.delete(id);
      pool.spare.push(node);
    }
    for (const item of items) {
      let node = pool.active.get(item.id);
      if (!node) {
        node = pool.spare.pop();
        if (!node) {
          node = pool.create();
          this.scene.add(node);
        }
        node.visible = true;
        pool.active.set(item.id, node);
      }
      node.position.set(item.x, item.y, item.z);
      if (update) update.call(this, node, item, time, reducedMotion);
    }
  }

  _updateFlyer(node, item, time, reducedMotion) {
    node.scale.setScalar(item.radius);
    const kind = Number.isInteger(item.kind) ? ((item.kind % 3) + 3) % 3 : 0;
    node.userData.body.material = this.flyerColors[kind];
    const flap = reducedMotion ? 0.12 : Math.sin(time * 9 + item.z * 0.07) * 0.32;
    node.userData.wings[0].rotation.z = -flap;
    node.userData.wings[1].rotation.z = flap;
  }

  _updateRock(node, item, time, reducedMotion) {
    node.scale.setScalar(item.radius);
    node.rotation.set(0.2, reducedMotion ? 0.35 : time * 0.22 + item.x, 0.18);
  }

  _updateRing(node, item, time, reducedMotion) {
    node.scale.setScalar(item.radius);
    node.rotation.set(0, 0, reducedMotion ? 0 : time * 0.42);
  }

  resize(width, height) {
    if (this.disposed) return;
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Full steering range plus ribbon width remains in-frame, even if a host
    // temporarily measures a narrow canvas before enforcing landscape layout.
    const halfFov = this.camera.fov * Math.PI / 360;
    this.camera.position.z = Math.max(16, 10 / (Math.tan(halfFov) * this.camera.aspect));
    this.camera.lookAt(0, 0, -35);
    this.camera.updateProjectionMatrix();
  }

  render(game, reducedMotion = false) {
    if (this.disposed) return;
    const time = game.elapsed;
    const dt = time - this.lastTime;
    if (dt < 0 || game.status === "ready") this.bank = 0;
    else if (dt > 0) {
      const wanted = THREE.MathUtils.clamp(-(game.player.x - this.lastX) / dt * 0.025, -0.23, 0.23);
      this.bank += (wanted - this.bank) * Math.min(1, dt * 9);
    }
    this.lastTime = time;
    this.lastX = game.player.x;
    this.player.position.set(game.player.x, game.player.y, 0);
    this.player.rotation.z = reducedMotion ? 0 : this.bank;
    for (let i = 0; i < this.arms.length; i++) {
      this.arms[i].rotation.x = reducedMotion ? 0 : Math.sin(time * 5 + i * Math.PI) * 0.035;
    }
    this.shield.visible = game.player.shield > 0;
    this.aim.position.set(game.player.x, game.player.y, 0);
    this._updateScenery(reducedMotion ? 0 : time);
    this._syncEntities(game.enemies, this.flyers, this._updateFlyer, time, reducedMotion);
    this._syncEntities(game.obstacles, this.rocks, this._updateRock, time, reducedMotion);
    this._syncEntities(game.rings, this.rings, this._updateRing, time, reducedMotion);
    this._syncEntities(game.shots, this.shots, null, time, reducedMotion);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const pool of [this.flyers, this.rocks, this.rings, this.shots]) {
      pool.active.clear();
      pool.spare.length = 0;
    }
    this.ids.clear();
    for (const mesh of [this.hills, this.hillCaps, this.clouds, this.route]) mesh.dispose();
    for (const geometry of Object.values(this.geometry)) geometry.dispose();
    for (const material of Object.values(this.material)) material.dispose();
    this.scene.clear();
    this.renderer.dispose();
  }
}
