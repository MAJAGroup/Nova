import * as THREE from "three";
import { glowTexture } from "./textures.js";

const DEPTH = 13;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smooth = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function randomPortalPoint() {
  return { x: -0.78 + Math.random() * 0.86, y: -0.54 + Math.random() * 1.08 };
}

function cubic(a, b, c, d, t) {
  const inverse = 1 - t;
  return inverse ** 3 * a + 3 * inverse ** 2 * t * b + 3 * inverse * t ** 2 * c + t ** 3 * d;
}

function cubicTangent(a, b, c, d, t) {
  const inverse = 1 - t;
  return 3 * inverse ** 2 * (b - a) + 6 * inverse * t * (c - b) + 3 * t ** 2 * (d - c);
}

function portalShader() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpen: { value: 0 }, uSeed: { value: Math.random() * 20 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpen;
      uniform float uSeed;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float angle = atan(p.y, p.x);
        float edge = 1.0 - smoothstep(0.78, 1.0, r);
        float rim = exp(-pow((r - 0.78) * 30.0, 2.0));
        float swirl = 0.5 + 0.5 * sin(angle * 4.0 - r * 25.0 - uTime * 5.0 + uSeed);
        float bands = 0.5 + 0.5 * sin(r * 38.0 - angle * 2.0 - uTime * 6.0 + swirl * 2.2);
        float core = 1.0 - smoothstep(0.04, 0.5, r);
        float light = edge * (0.32 + bands * 0.18 + swirl * 0.12) + rim * 0.8 + core * 0.25;
        vec3 fringe = mix(vec3(0.48, 0.72, 1.0), vec3(0.82, 0.65, 1.0), swirl);
        vec3 color = mix(vec3(0.82, 0.93, 1.0), vec3(1.0), clamp(rim + core * 0.6, 0.0, 1.0));
        color = mix(fringe, color, 0.78);
        gl_FragColor = vec4(color * light, edge * (0.32 + 0.48 * bands) + rim * 0.35 + core * 0.12);
        gl_FragColor.a *= uOpen;
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
}

function makePortal(sceneRoot, camera) {
  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 20;
  const apertureMaterial = portalShader();
  const aperture = new THREE.Mesh(new THREE.CircleGeometry(0.92, 64), apertureMaterial);
  aperture.position.z = -0.08;
  aperture.renderOrder = 20;
  group.add(aperture);

  const rings = [];
  const ringData = [
    { radius: 0.91, tube: 0.035, color: 0xffffff, opacity: 0.95 },
    { radius: 1.0, tube: 0.013, color: 0xdff8ff, opacity: 0.8 },
    { radius: 1.12, tube: 0.008, color: 0xb2caff, opacity: 0.6 }
  ];
  for (const [index, item] of ringData.entries()) {
    const material = new THREE.MeshBasicMaterial({
      color: item.color,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(item.radius, item.tube, 8, 80), material);
    ring.rotation.x = index % 2 ? 0.06 : -0.04;
    ring.rotation.y = index === 2 ? 0.08 : 0;
    ring.position.z = index * 0.015;
    ring.renderOrder = 21 + index;
    group.add(ring);
    rings.push({ mesh: ring, material, baseOpacity: item.opacity, index });
  }

  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture(), color: 0xf2f8ff, transparent: true, opacity: 0,
    depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const glow = new THREE.Sprite(glowMaterial);
  glow.scale.set(3.8, 4.7, 1);
  glow.position.z = -0.18;
  glow.renderOrder = 19;
  group.add(glow);
  sceneRoot.add(group);

  return {
    group,
    apertureMaterial,
    rings,
    glowMaterial,
    glow,
    point: randomPortalPoint(),
    progress: 0,
    visible: false,
    setPoint(point) { this.point = point; },
    setForeground(foreground) {
      this.glow.renderOrder = foreground ? 49 : 19;
      this.aperture.renderOrder = foreground ? 50 : 20;
      for (const item of this.rings) item.mesh.renderOrder = foreground ? 51 + item.index : 21 + item.index;
    },
    setEntryMask(enabled) {
      this.apertureMaterial.depthWrite = enabled;
      this.apertureMaterial.needsUpdate = true;
    },
    show(opening, time, depth = DEPTH) {
      this.visible = opening > 0.005;
      this.progress = opening;
      this.group.visible = this.visible;
      if (!this.visible) return;
      const depthHeight = depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      this.group.position.set(this.point.x * depthHeight * camera.aspect, this.point.y * depthHeight, -depth);
      const eased = smooth(opening);
      const pulse = 1 + Math.sin(time * 11) * 0.025 * eased;
      this.group.scale.set(eased * pulse, eased * pulse * 1.23, eased);
      this.apertureMaterial.uniforms.uTime.value = time;
      this.apertureMaterial.uniforms.uOpen.value = eased;
      this.glowMaterial.opacity = 0.7 * eased;
      this.glow.scale.set(3.8 + eased * 0.45, 4.7 + eased * 0.6, 1);
      for (const item of this.rings) {
        item.material.opacity = item.baseOpacity * eased * (0.85 + Math.sin(time * 7 + item.index) * 0.15);
        item.mesh.rotation.z = time * (item.index % 2 ? -0.48 : 0.35) + item.index * 0.7;
      }
    },
    dispose() {
      this.group.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) object.material.dispose();
      });
    }
  };
}

function makeShip(root) {
  const ship = new THREE.Group();
  ship.visible = false;
  ship.renderOrder = 40;
  const hullShape = new THREE.Shape();
  hullShape.moveTo(0.68, 0);
  hullShape.lineTo(0.14, 0.16);
  hullShape.lineTo(-0.16, 0.48);
  hullShape.lineTo(-0.23, 0.2);
  hullShape.lineTo(-0.49, 0.23);
  hullShape.lineTo(-0.31, 0);
  hullShape.lineTo(-0.49, -0.23);
  hullShape.lineTo(-0.23, -0.2);
  hullShape.lineTo(-0.16, -0.48);
  hullShape.lineTo(0.14, -0.16);
  hullShape.closePath();
  const hull = new THREE.Mesh(
    new THREE.ShapeGeometry(hullShape),
    new THREE.MeshBasicMaterial({ color: 0xf4fbff, side: THREE.DoubleSide, depthTest: false })
  );
  hull.renderOrder = 40;
  hull.position.z = 0.03;
  ship.add(hull);

  const cockpit = new THREE.Mesh(
    new THREE.CircleGeometry(0.105, 20),
    new THREE.MeshBasicMaterial({ color: 0x99edff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthTest: false })
  );
  cockpit.renderOrder = 41;
  cockpit.position.set(0.11, 0, 0.05);
  ship.add(cockpit);

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.105, 0.5, 7),
    new THREE.MeshBasicMaterial({ color: 0xc7f8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthTest: false })
  );
  flame.renderOrder = 39;
  flame.rotation.z = Math.PI / 2;
  flame.position.set(-0.57, 0, -0.01);
  ship.add(flame);

  const engineMaterial = new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9beeff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
  const engine = new THREE.Sprite(engineMaterial);
  engine.renderOrder = 39;
  engine.position.set(-0.66, 0, -0.02);
  engine.scale.set(0.9, 0.5, 1);
  ship.add(engine);
  root.add(ship);
  return {
    group: ship, flame, engine,
    setDepthTest(enabled) {
      hull.material.depthTest = enabled;
      cockpit.material.depthTest = enabled;
      flame.material.depthTest = enabled;
      engine.material.depthTest = enabled;
    }
  };
}

function makeTrail(root, color, opacity) {
  const count = 18;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 38;
  line.visible = false;
  root.add(line);
  const history = Array.from({ length: count }, () => ({ x: 0, y: 0, z: -DEPTH }));
  return { line, geometry, positions, history, timer: 0 };
}

function makeStreakPool(root, size = 10) {
  const geometry = new THREE.PlaneGeometry(1.5, 0.018);
  const pool = [];
  for (let index = 0; index < size; index++) {
    const material = new THREE.MeshBasicMaterial({
      color: index % 3 ? 0xc7f2ff : 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.renderOrder = 36;
    root.add(mesh);
    pool.push({ mesh, material, age: 1, life: 0.34, x: 0, y: 0, point: { x: 0, y: 0 }, local: new THREE.Vector3(), angle: 0 });
  }
  return pool;
}

// A camera-facing white wormhole and explorer ship. Its animation never
// changes the user's camera, so it can play over the existing live scene.
export function createExplorerFlight(scene, camera) {
  const rig = new THREE.Group();
  rig.renderOrder = 18;
  scene.add(rig);
  const portal = makePortal(rig, camera);
  const ship = makeShip(rig);
  const trails = [makeTrail(rig, 0xeafaff, 0.82), makeTrail(rig, 0x81d8ff, 0.45)];
  const streaks = makeStreakPool(rig);
  const historyPoints = [new THREE.Vector3(), new THREE.Vector3()];
  const shipLocal = new THREE.Vector3();

  let phase = "idle";
  let elapsed = 0;
  let time = 0;
  let exitRequested = false;
  let nextStreak = 0;
  let streakCursor = 0;
  let current = { x: -0.3, y: 0.05 };
  let cruiseFrom = { ...current };
  let cruiseTo = { x: 0.1, y: 0.18 };
  let cruiseDuration = 0.8;
  let cruiseElapsed = 0;
  let cruiseArc = 0.12;
  let travel = null;
  let entryPath = null;
  let entryPoint = { ...current };
  let exitPoint = { ...current };
  let previousExitPoint = null;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function localFromNdc(point, depth = DEPTH, target = new THREE.Vector3()) {
    const halfHeight = depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const halfWidth = halfHeight * camera.aspect;
    return target.set(point.x * halfWidth, point.y * halfHeight, -depth);
  }

  function updateRig() {
    rig.position.copy(camera.position);
    rig.quaternion.copy(camera.quaternion);
  }

  function showShip(point, depth = DEPTH, scale = 1, angle = 0) {
    ship.group.visible = true;
    ship.group.position.copy(localFromNdc(point, depth, shipLocal));
    ship.group.scale.setScalar(scale);
    ship.group.rotation.z = angle;
    ship.flame.scale.y = 0.86 + Math.sin(time * 24) * 0.18;
    ship.engine.material.opacity = 0.78 + Math.sin(time * 19) * 0.16;
  }

  function openPortal(point) {
    portal.setPoint(point);
    portal.group.visible = true;
  }

  function makeDifferentPortalPoint(from) {
    let point = randomPortalPoint();
    for (let attempt = 0; attempt < 16; attempt++) {
      point = randomPortalPoint();
      const awayFromShip = Math.hypot(point.x - from.x, point.y - from.y) > 0.42;
      const awayFromLastPortal = !previousExitPoint || Math.hypot(point.x - previousExitPoint.x, point.y - previousExitPoint.y) > 0.28;
      if (awayFromShip && awayFromLastPortal) break;
    }
    previousExitPoint = { ...point };
    return point;
  }

  function startCruise() {
    portal.show(0, time);
    portal.group.visible = false;
    portal.setEntryMask(false);
    ship.setDepthTest(false);
    phase = "cruise";
    elapsed = 0;
    current = { ...current };
    ship.group.visible = true;
    pickCruiseSegment();
    if (exitRequested) beginExit();
  }

  function pickCruiseSegment() {
    cruiseFrom = { ...current };
    cruiseTo = { x: -0.82 + Math.random() * 0.94, y: -0.72 + Math.random() * 1.44 };
    const distance = Math.hypot(cruiseTo.x - cruiseFrom.x, cruiseTo.y - cruiseFrom.y);
    cruiseDuration = reducedMotion ? 1.4 + Math.random() * 0.4 : Math.max(0.38, Math.min(0.85, distance * 0.62));
    cruiseElapsed = 0;
    cruiseArc = (Math.random() < 0.5 ? -1 : 1) * (0.07 + Math.random() * 0.2);
  }

  function beginExit() {
    phase = "exit";
    elapsed = 0;
    exitPoint = makeDifferentPortalPoint(current);
    portal.setForeground(true);
    openPortal(exitPoint);
    const from = { ...current };
    const to = { ...exitPoint };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    const bend = (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.12);
    travel = {
      from,
      c1: { x: from.x + dx * 0.28 - dy / length * bend, y: from.y + dy * 0.28 + dx / length * bend },
      c2: { x: from.x + dx * 0.72 - dy / length * bend, y: from.y + dy * 0.72 + dx / length * bend },
      to
    };
  }

  function spawnStreak() {
    const item = streaks[streakCursor++ % streaks.length];
    item.age = 0;
    item.x = current.x + (Math.random() - 0.5) * 0.28;
    item.y = current.y + (Math.random() - 0.5) * 0.28;
    item.angle = ship.group.rotation.z;
    item.mesh.visible = true;
  }

  function updateStreaks(delta) {
    for (const item of streaks) {
      if (item.age >= item.life) continue;
      item.age += delta;
      const progress = clamp01(item.age / item.life);
      const fade = Math.sin(progress * Math.PI) * 0.75;
      const travel = progress * 0.18;
      item.point.x = item.x - Math.cos(item.angle) * travel;
      item.point.y = item.y - Math.sin(item.angle) * travel;
      item.mesh.position.copy(localFromNdc(item.point, DEPTH + 0.3, item.local));
      item.mesh.rotation.z = item.angle;
      item.material.opacity = fade;
      item.mesh.visible = fade > 0.01;
    }
  }

  function updateTrails(point, delta) {
    for (const trail of trails) {
      trail.timer += delta;
      if (trail.timer >= 0.035) {
        trail.timer = 0;
        for (let index = trail.history.length - 1; index > 0; index--) {
          trail.history[index].x = trail.history[index - 1].x;
          trail.history[index].y = trail.history[index - 1].y;
        }
        trail.history[0].x = point.x;
        trail.history[0].y = point.y;
      }
      for (let index = 0; index < trail.history.length; index++) {
        const item = trail.history[index];
        const local = localFromNdc(item, DEPTH + 0.2, historyPoints[index % historyPoints.length]);
        const offset = index * 3;
        trail.positions[offset] = local.x;
        trail.positions[offset + 1] = local.y;
        trail.positions[offset + 2] = local.z;
      }
      trail.geometry.attributes.position.needsUpdate = true;
      trail.line.visible = phase === "cruise" || phase === "exit";
    }
  }

  function setShipAlongTravel(path, progress, depth = DEPTH) {
    const t = smooth(progress);
    current.x = cubic(path.from.x, path.c1.x, path.c2.x, path.to.x, t);
    current.y = cubic(path.from.y, path.c1.y, path.c2.y, path.to.y, t);
    const dx = cubicTangent(path.from.x, path.c1.x, path.c2.x, path.to.x, t);
    const dy = cubicTangent(path.from.y, path.c1.y, path.c2.y, path.to.y, t);
    const angle = Math.atan2(dy, dx);
    const scale = phase === "exit" ? 1 - smooth((progress - 0.72) / 0.28) * 0.98 : 0.85 + smooth(progress) * 0.15;
    showShip(current, depth, Math.max(0.015, scale), angle);
    return current;
  }

  function start() {
    cancel();
    updateRig();
    phase = "entry";
    elapsed = 0;
    exitRequested = false;
    entryPoint = randomPortalPoint();
    const direction = { x: entryPoint.x < -0.1 ? 1 : -1, y: entryPoint.y < 0 ? 0.24 : -0.22 };
    const target = { x: Math.max(-0.82, Math.min(0.1, entryPoint.x + direction.x * 0.35)), y: Math.max(-0.72, Math.min(0.72, entryPoint.y + direction.y)) };
    entryPath = {
      from: entryPoint,
      c1: { x: entryPoint.x + direction.x * 0.06, y: entryPoint.y + direction.y * 0.04 },
      c2: { x: entryPoint.x + direction.x * 0.24, y: entryPoint.y + direction.y * 0.85 },
      to: target
    };
    portal.setForeground(false);
    portal.setEntryMask(true);
    ship.setDepthTest(true);
    openPortal(entryPoint);
    ship.group.visible = false;
    current = { ...entryPoint };
    for (const trail of trails) {
      trail.line.visible = false;
      trail.history.forEach((point) => { point.x = entryPoint.x; point.y = entryPoint.y; });
    }
    for (const streak of streaks) { streak.mesh.visible = false; streak.age = streak.life; }
  }

  function finish() {
    if (phase === "idle" || phase === "exit") return;
    exitRequested = true;
    if (phase === "cruise") beginExit();
  }

  function cancel() {
    phase = "idle";
    elapsed = 0;
    exitRequested = false;
    travel = null;
    portal.setForeground(false);
    portal.setEntryMask(false);
    ship.setDepthTest(false);
    portal.group.visible = false;
    ship.group.visible = false;
    for (const trail of trails) trail.line.visible = false;
    for (const streak of streaks) streak.mesh.visible = false;
  }

  function update(now, delta) {
    if (phase === "idle") return false;
    time = now;
    updateRig();
    if (phase === "entry") {
      elapsed += delta;
      const opening = smooth(elapsed / 0.26);
      const closing = 1 - smooth((elapsed - 0.95) / 0.36);
      portal.show(opening * closing, time);
      const emergence = clamp01((elapsed - 0.22) / 0.82);
      if (emergence > 0) {
        setShipAlongTravel(entryPath, emergence, DEPTH + (1 - emergence) * 2.5 - emergence * 3);
      }
      if (elapsed >= 1.34) startCruise();
    } else if (phase === "cruise") {
      elapsed += delta;
      cruiseElapsed += delta;
      if (cruiseElapsed >= cruiseDuration) pickCruiseSegment();
      const t = clamp01(cruiseElapsed / cruiseDuration);
      const bend = cruiseArc * Math.sin(Math.PI * t);
      const dx = cruiseTo.x - cruiseFrom.x;
      const dy = cruiseTo.y - cruiseFrom.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      const bendX = -dy / distance * bend;
      const bendY = dx / distance * bend;
      current.x = cubic(cruiseFrom.x, cruiseFrom.x + dx * 0.28 + bendX, cruiseFrom.x + dx * 0.72 + bendX, cruiseTo.x, t);
      current.y = cubic(cruiseFrom.y, cruiseFrom.y + dy * 0.28 + bendY, cruiseFrom.y + dy * 0.72 + bendY, cruiseTo.y, t);
      const vx = cubicTangent(cruiseFrom.x, cruiseFrom.x + dx * 0.28 + bendX, cruiseFrom.x + dx * 0.72 + bendX, cruiseTo.x, t);
      const vy = cubicTangent(cruiseFrom.y, cruiseFrom.y + dy * 0.28 + bendY, cruiseFrom.y + dy * 0.72 + bendY, cruiseTo.y, t);
      showShip(current, DEPTH - 0.8, 1, Math.atan2(vy, vx));
      if (!reducedMotion && elapsed >= nextStreak) {
        spawnStreak();
        nextStreak = elapsed + 0.09 + Math.random() * 0.08;
      }
      updateStreaks(delta);
      updateTrails(current, delta);
    } else if (phase === "exit") {
      elapsed += delta;
      const opening = smooth(elapsed / 0.36);
      const closing = 1 - smooth((elapsed - 1.08) / 0.38);
      portal.show(opening * closing, time);
      const progress = clamp01((elapsed - 0.12) / 0.98);
      setShipAlongTravel(travel, progress, DEPTH - 0.8 + smooth((progress - 0.72) / 0.28) * 3.3);
      updateStreaks(delta);
      updateTrails(current, delta);
      if (elapsed >= 1.48) {
        portal.show(0, time);
        ship.group.visible = false;
        for (const trail of trails) trail.line.visible = false;
        for (const streak of streaks) streak.mesh.visible = false;
        phase = "idle";
        return true;
      }
    }
    return false;
  }

  return { start, finish, cancel, update };
}
