import * as THREE from "three";
import { glowTexture } from "./textures.js";

const DECISION_SECONDS = 20;
const ORBIT_SECONDS = 8;
const TRANSIT_SECONDS = 1.2;
const VIEW_DEPTH = 13;
const BLACK_HOLE = { id: "__ambient-ufo-black-hole__", kind: "black-hole", position: new THREE.Vector3() };

const clamp01 = value => Math.max(0, Math.min(1, value));
const smooth = value => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function curvedPath(from, to, bend = 1) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const distance = Math.max(.001, Math.hypot(dx, dy));
  const offset = bend * Math.min(.25, Math.max(.1, distance * .2));
  const normalX = -dy / distance, normalY = dx / distance;
  return {
    from: { ...from },
    c1: { x: from.x + dx * .28 + normalX * offset, y: from.y + dy * .28 + normalY * offset },
    c2: { x: from.x + dx * .72 + normalX * offset, y: from.y + dy * .72 + normalY * offset },
    to: { ...to }
  };
}

function cubic(a, b, c, d, t) {
  const inverse = 1 - t;
  return inverse ** 3 * a + 3 * inverse ** 2 * t * b + 3 * inverse * t ** 2 * c + t ** 3 * d;
}

function cubicTangent(a, b, c, d, t) {
  const inverse = 1 - t;
  return 3 * inverse ** 2 * (b - a) + 6 * inverse * t * (c - b) + 3 * t ** 2 * (d - c);
}

function createGreenWormhole(rig) {
  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 45;

  const apertureMaterial = new THREE.ShaderMaterial({
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
        float swirl = 0.5 + 0.5 * sin(angle * 5.0 - r * 23.0 - uTime * 5.4 + uSeed);
        float bands = 0.5 + 0.5 * sin(r * 37.0 - angle * 2.0 - uTime * 6.2 + swirl * 2.0);
        float core = 1.0 - smoothstep(0.04, 0.48, r);
        float light = edge * (0.34 + bands * 0.18 + swirl * 0.12) + rim * 0.9 + core * 0.2;
        vec3 green = mix(vec3(0.06, 0.62, 0.28), vec3(0.32, 1.0, 0.58), swirl);
        vec3 color = mix(green, vec3(0.84, 1.0, 0.9), clamp(rim + core * 0.65, 0.0, 1.0));
        gl_FragColor = vec4(color * light, (edge * (0.35 + 0.45 * bands) + rim * 0.45 + core * 0.12) * uOpen);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  const aperture = new THREE.Mesh(new THREE.CircleGeometry(.9, 64), apertureMaterial);
  aperture.position.z = -.08;
  aperture.renderOrder = 46;
  group.add(aperture);

  const rings = [];
  for (const [index, [radius, tube, color, opacity]] of [
    [.91, .032, 0xa1ffc0, .92],
    [1.02, .014, 0x53ff9a, .78],
    [1.13, .008, 0x31b975, .56]
  ].entries()) {
    const material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false
    });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 80), material);
    mesh.position.z = index * .015;
    mesh.renderOrder = 47 + index;
    group.add(mesh);
    rings.push({ mesh, material, opacity, index });
  }

  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture(), color: 0x40ff89, transparent: true, opacity: 0,
    depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
  });
  const glow = new THREE.Sprite(glowMaterial);
  glow.scale.set(4.2, 4.8, 1);
  glow.position.z = -.18;
  glow.renderOrder = 44;
  group.add(glow);
  rig.add(group);

  return {
    group,
    apertureMaterial,
    rings,
    glowMaterial,
    glow,
    show(point, opening, time, camera) {
      const amount = smooth(opening);
      group.visible = amount > .005;
      if (!group.visible) return;
      const halfHeight = VIEW_DEPTH * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      group.position.set(point.x * halfHeight * camera.aspect, point.y * halfHeight, -VIEW_DEPTH);
      const pulse = 1 + Math.sin(time * 11) * .025 * amount;
      group.scale.set(amount * pulse, amount * pulse * 1.2, amount);
      apertureMaterial.uniforms.uTime.value = time;
      apertureMaterial.uniforms.uOpen.value = amount;
      glowMaterial.opacity = .68 * amount;
      for (const item of rings) {
        item.material.opacity = item.opacity * amount * (.85 + Math.sin(time * 7 + item.index) * .15);
        item.mesh.rotation.z = time * (item.index % 2 ? -.5 : .36) + item.index * .7;
      }
    },
    hide() {
      group.visible = false;
      apertureMaterial.uniforms.uOpen.value = 0;
      glowMaterial.opacity = 0;
      for (const item of rings) item.material.opacity = 0;
    }
  };
}

function createSaucer(rig) {
  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 60;
  const solid = (color, options = {}) => new THREE.MeshPhongMaterial({
    color, specular: 0x9eabb6, shininess: 44, side: THREE.DoubleSide,
    depthTest: false, depthWrite: false, toneMapped: false, ...options
  });
  const hull = solid(0x414a53, { specular: 0xc2d0d6, shininess: 60 });
  const silver = solid(0xa4b5c2, { shininess: 72 });
  const dark = solid(0x17212a, { shininess: 30 });
  const glass = solid(0x69c9e9, {
    color: 0x92d9f4, emissive: 0x164f70, transparent: true, opacity: .72,
    shininess: 100, depthWrite: false
  });
  const add = (geometry, material, position, rotationX = 0, order = 61) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.x = rotationX;
    mesh.renderOrder = order;
    group.add(mesh);
    return mesh;
  };

  // Layered, flattened hulls give the saucer a broad beveled rim like the
  // reference while keeping its silhouette readable at star-map scale.
  add(new THREE.CylinderGeometry(.72, 1.18, .2, 64, 1), dark, [0, 0, 0], Math.PI / 2, 61);
  add(new THREE.CylinderGeometry(1.17, 1.08, .12, 64, 1), hull, [0, 0, .09], Math.PI / 2, 62);
  add(new THREE.TorusGeometry(1.12, .035, 10, 72), silver, [0, 0, .105], 0, 63);
  add(new THREE.TorusGeometry(.76, .025, 8, 64), dark, [0, 0, -.105], 0, 63);

  const dome = add(new THREE.SphereGeometry(.64, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2), glass, [0, .015, .12], Math.PI / 2, 64);
  dome.scale.set(1.08, .78, 1);
  const domeRim = add(new THREE.TorusGeometry(.59, .024, 8, 48), silver, [0, 0, .125], 0, 65);
  domeRim.scale.set(1.08, .78, 1);

  // Keep the underside as a solid hull detail, without floating sparks or
  // particle-like lamps around the saucer.
  add(new THREE.CylinderGeometry(.37, .3, .11, 40), dark, [0, 0, -.14], Math.PI / 2, 64);
  add(new THREE.TorusGeometry(.34, .035, 10, 48), silver, [0, 0, -.2], 0, 65);

  const reactor = new THREE.Mesh(new THREE.CircleGeometry(.25, 48), new THREE.MeshBasicMaterial({
    color: 0x9beaff, transparent: true, opacity: .88, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false
  }));
  reactor.position.z = -.258;
  reactor.renderOrder = 66;
  group.add(reactor);

  // Orbit's star map has no scene lights, so give the metal hull its own
  // soft studio lighting; otherwise only the emissive glass dome is visible.
  group.add(new THREE.AmbientLight(0xc9d9e5, 1.7));
  const keyLight = new THREE.PointLight(0xffffff, 3.1, 8, 2);
  keyLight.position.set(-.7, .85, 2.4);
  group.add(keyLight);
  const rimLight = new THREE.PointLight(0x75dfff, 1.9, 6, 2);
  rimLight.position.set(.3, -.45, -.9);
  group.add(rimLight);

  rig.add(group);
  return group;
}

// A single ambient saucer. Its countdown only advances while Orbit is open;
// after two eight-second target orbits it leaves through a green wormhole.
export function createAmbientUfo(scene, camera, { getStarCount, getStarTargets, positionOf } = {}) {
  const rig = new THREE.Group();
  rig.renderOrder = 44;
  scene.add(rig);
  const wormhole = createGreenWormhole(rig);
  const ship = createSaucer(rig);
  let phase = "idle";
  let sceneOpen = false;
  let remaining = DECISION_SECONDS;
  let elapsed = 0;
  let time = 0;
  let current = { x: -.4, y: .1 };
  let targetPath = null;
  let exitPoint = null;
  let targetList = [];
  let targetIndex = 0;
  let orbitPhase = 0;
  let heading = 0;

  function updateRig() {
    rig.position.copy(camera.position);
    rig.quaternion.copy(camera.quaternion);
  }

  function localFromScreen(point, depth = VIEW_DEPTH) {
    const halfHeight = depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return new THREE.Vector3(point.x * halfHeight * camera.aspect, point.y * halfHeight, -depth);
  }

  function screenPoint(target) {
    const world = target.kind === "black-hole"
      ? BLACK_HOLE.position
      : (positionOf && positionOf(target.id)) || target.position;
    if (!world) return { x: 0, y: 0 };
    camera.updateMatrixWorld(true);
    const projected = world.clone().project(camera);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.z < -1 || projected.z > 1) return { x: 0, y: 0 };
    return {
      x: THREE.MathUtils.clamp(projected.x, -.76, .76),
      y: THREE.MathUtils.clamp(projected.y, -.68, .68)
    };
  }

  function randomPortalPoint() {
    return { x: -.82 + Math.random() * 1.64, y: -.66 + Math.random() * 1.32 };
  }

  function chooseTargets() {
    const stars = (getStarTargets ? getStarTargets() : [])
      .filter(target => target && target.id != null && target.position)
      .map(target => ({ id: String(target.id), kind: "star", position: target.position }));
    const star = stars.length ? stars[Math.floor(Math.random() * stars.length)] : null;
    targetList = star
      ? (Math.random() < .5 ? [BLACK_HOLE, star] : [star, BLACK_HOLE])
      : [BLACK_HOLE, BLACK_HOLE];
    targetIndex = 0;
  }

  function placeShip(point, scale = 1, angle = heading) {
    ship.visible = true;
    ship.position.copy(localFromScreen(point, VIEW_DEPTH - .4));
    ship.scale.setScalar(scale);
    ship.rotation.set(.31 + Math.sin(time * 1.7) * .07, .15 + Math.sin(time * 1.1) * .12, angle);
    heading = angle;
  }

  function beginOrbit() {
    phase = "orbit";
    elapsed = 0;
    current = screenPoint(targetList[targetIndex]);
    orbitPhase = Math.random() * Math.PI * 2;
    placeShip(current, 1);
    wormhole.hide();
  }

  function beginEntry() {
    chooseTargets();
    elapsed = 0;
    phase = "entry";
    const entrance = randomPortalPoint();
    const destination = screenPoint(targetList[0]);
    current = { ...entrance };
    targetPath = curvedPath(entrance, destination, Math.random() < .5 ? -1 : 1);
    ship.visible = false;
    wormhole.show(entrance, 0, time, camera);
  }

  function beginTransit() {
    targetIndex = Math.min(targetIndex + 1, targetList.length - 1);
    elapsed = 0;
    phase = "transit";
    targetPath = curvedPath(current, screenPoint(targetList[targetIndex]), Math.random() < .5 ? -1 : 1);
  }

  function beginExit() {
    phase = "exit";
    elapsed = 0;
    exitPoint = randomPortalPoint();
    for (let attempt = 0; attempt < 12 && Math.hypot(exitPoint.x - current.x, exitPoint.y - current.y) < .45; attempt++) exitPoint = randomPortalPoint();
    targetPath = curvedPath(current, exitPoint, Math.random() < .5 ? -1 : 1);
    wormhole.show(exitPoint, 0, time, camera);
  }

  function travelOnPath(progress, scale = 1) {
    const t = smooth(progress);
    current.x = cubic(targetPath.from.x, targetPath.c1.x, targetPath.c2.x, targetPath.to.x, t);
    current.y = cubic(targetPath.from.y, targetPath.c1.y, targetPath.c2.y, targetPath.to.y, t);
    const dx = cubicTangent(targetPath.from.x, targetPath.c1.x, targetPath.c2.x, targetPath.to.x, t);
    const dy = cubicTangent(targetPath.from.y, targetPath.c1.y, targetPath.c2.y, targetPath.to.y, t);
    heading = Math.atan2(dy, dx);
    placeShip(current, scale, heading);
  }

  function orbitTarget() {
    const center = screenPoint(targetList[targetIndex]);
    const angle = orbitPhase + elapsed * Math.PI * 2 / ORBIT_SECONDS;
    const radiusY = .24;
    const radiusX = radiusY / Math.max(.65, camera.aspect);
    current.x = center.x + Math.cos(angle) * radiusX;
    current.y = center.y + Math.sin(angle) * radiusY;
    heading = Math.atan2(Math.cos(angle) * radiusY, -Math.sin(angle) * radiusX);
    placeShip(current, 1, heading);
  }

  function resetAfterDeparture() {
    ship.visible = false;
    wormhole.hide();
    phase = "idle";
    elapsed = 0;
    remaining = DECISION_SECONDS;
    targetPath = null;
    targetList = [];
  }

  function openScene() {
    sceneOpen = true;
    if (phase === "idle") remaining = DECISION_SECONDS;
  }

  function closeScene() {
    sceneOpen = false;
    if (phase === "idle") remaining = DECISION_SECONDS;
  }

  function update(now, delta) {
    if (!sceneOpen) return;
    time = now;
    updateRig();
    if (phase === "idle") {
      remaining -= delta;
      if (remaining > 0) return;
      const starCount = Math.max(0, Number(getStarCount ? getStarCount() : 0) || 0);
      const chance = Math.min(1, starCount * .1);
      if (Math.random() < chance) beginEntry();
      else remaining = DECISION_SECONDS;
      return;
    }

    elapsed += delta;
    if (phase === "entry") {
      const opening = smooth(elapsed / .28) * (1 - smooth((elapsed - 1.04) / .34));
      wormhole.show(targetPath.from, opening, time, camera);
      const progress = clamp01((elapsed - .22) / .96);
      if (progress > 0) travelOnPath(progress, .12 + smooth(progress) * .88);
      if (elapsed >= 1.38) beginOrbit();
    } else if (phase === "orbit") {
      orbitTarget();
      if (elapsed >= ORBIT_SECONDS) {
        if (targetIndex + 1 < targetList.length) beginTransit();
        else beginExit();
      }
    } else if (phase === "transit") {
      travelOnPath(clamp01(elapsed / TRANSIT_SECONDS), .9 + smooth(elapsed / TRANSIT_SECONDS) * .1);
      if (elapsed >= TRANSIT_SECONDS) beginOrbit();
    } else if (phase === "exit") {
      const opening = smooth(elapsed / .28) * (1 - smooth((elapsed - 1.02) / .38));
      wormhole.show(exitPoint, opening, time, camera);
      const progress = clamp01((elapsed - .08) / 1.04);
      const scale = 1 - smooth((progress - .66) / .34) * .985;
      travelOnPath(progress, Math.max(.015, scale));
      if (elapsed >= 1.42) resetAfterDeparture();
    }
  }

  return { openScene, closeScene, update };
}
