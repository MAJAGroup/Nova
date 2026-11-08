import * as THREE from "three";
import { glowTexture } from "./textures.js";

// Blue-white, white, yellow, orange and the odd red giant.
const SKY_COLORS = [0xffffff, 0xcfdcff, 0xa9c4ff, 0xffe2b8, 0xffd27a, 0xffb27a, 0xff9a8a, 0xbff6ff];
const NEBULAE = [
  { color: 0x3948aa, position: [-260, 80, -320], scale: 380, opacity: 0.2 },
  { color: 0x1c7f8e, position: [300, -60, -260], scale: 300, opacity: 0.14 },
  { color: 0x6b3fa0, position: [40, 160, 340], scale: 340, opacity: 0.13 },
  { color: 0x23306e, position: [-120, -200, 200], scale: 420, opacity: 0.16 },
  { color: 0xb07a2a, position: [330, 140, 180], scale: 320, opacity: 0.1 },
  { color: 0x9a3f5c, position: [-340, -40, 60], scale: 280, opacity: 0.08 }
];
// The plane of the distant galaxy's band across the sky. It is nearly
// vertical, so from the usual view looking down on the tabs the band runs
// across the screen whichever way the camera has turned.
const BAND_NORMAL = new THREE.Vector3(0.9, 0.18, -0.4).normalize();

const METEOR = {
  minGap: 2.5,
  maxGap: 7,
  distance: 150,
  colors: [0xfff4dc, 0xfff0b0, 0xd8f4ff, 0xc8ffd8]
};

function randomDirection() {
  const u = Math.random() * 2 - 1;
  const theta = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(s * Math.cos(theta), u, s * Math.sin(theta));
}

// A direction near the galactic band, so stars crowd along it.
function bandDirection() {
  const direction = randomDirection();
  const offset = BAND_NORMAL.clone().multiplyScalar(direction.dot(BAND_NORMAL) * 0.85);
  return direction.sub(offset).normalize();
}

function points(positions, colors, material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Points(geometry, material);
}

// Distant stars on a sphere around everything, fixed-size on screen: many
// faint ones, crowding along the band, and a sprinkling of bright ones.
function createStars(count, size, brightness, bandShare) {
  const positions = [];
  const colors = [];
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const direction = Math.random() < bandShare ? bandDirection() : randomDirection();
    const point = direction.multiplyScalar(260 + Math.random() * 340);
    positions.push(point.x, point.y, point.z);
    color.setHex(SKY_COLORS[Math.floor(Math.random() * SKY_COLORS.length)]).multiplyScalar(brightness[0] + Math.random() * brightness[1]);
    colors.push(color.r, color.g, color.b);
  }
  return points(positions, colors, new THREE.PointsMaterial({
    size, sizeAttenuation: false, map: glowTexture(), vertexColors: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
  }));
}

// The far sky itself: a band of golden galactic light with dark dust lanes
// and yellow grain, plus faint coloured clouds elsewhere. Drawn first, onto
// the clear colour.
const skyVertex = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const skyFragment = /* glsl */ `
  uniform vec3 uBandNormal;
  varying vec3 vDirection;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDirection);
    float lat = dot(d, uBandNormal);
    float band = exp(-lat * lat * 12.0);
    float core = exp(-lat * lat * 55.0);
    float clouds = fbm(d * 3.0);
    float detail = fbm(d * 9.0 + 4.0);
    float lanes = smoothstep(0.46, 0.72, fbm(d * 6.0 + 11.0));

    vec3 gold = vec3(1.0, 0.78, 0.4);
    vec3 amber = vec3(0.95, 0.52, 0.22);
    vec3 blue = vec3(0.22, 0.32, 0.75);
    vec3 violet = vec3(0.45, 0.24, 0.7);

    float glow = band * (0.3 + 0.7 * clouds) * (0.55 + 0.45 * detail);
    vec3 color = mix(blue, gold, smoothstep(0.2, 0.8, band * clouds * 1.5)) * glow * 0.3;
    color += mix(gold, amber, detail) * core * detail * 0.28;
    color *= 1.0 - lanes * band * 0.8;

    // Faint coloured clouds away from the band.
    float patches = smoothstep(0.56, 0.86, fbm(d * 2.0 + 23.0));
    color += mix(violet, amber, fbm(d * 1.5 + 5.0)) * patches * 0.06;

    // Yellow grain: unresolved stars glittering in the band.
    float grain = pow(noise(d * 240.0), 14.0) + pow(noise(d * 520.0 + 7.0), 18.0) * 0.6;
    color += gold * grain * (0.2 + band * 1.4);

    gl_FragColor = vec4(color, 1.0);
  }
`;

function createGalaxySky() {
  const material = new THREE.ShaderMaterial({
    uniforms: { uBandNormal: { value: BAND_NORMAL.clone() } },
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    fog: false
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 64, 32), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

const DUST = {
  count: 2200,
  size: 0.45,
  opacity: 0.85,
  saturation: 0.65,
  minLightness: 0.45,
  lightnessRange: 0.3
};

// Dust in the plane where the tab stars live, so the disc reads as a galaxy.
// Mostly blue, with a share of warm gold motes.
function createDust() {
  const positions = [];
  const colors = [];
  const color = new THREE.Color();
  for (let i = 0; i < DUST.count; i++) {
    const radius = 3.5 + Math.pow(Math.random(), 0.7) * 54;
    const angle = Math.random() * Math.PI * 2;
    const spread = (Math.random() + Math.random() - 1) * (1 + radius * 0.06);
    positions.push(Math.cos(angle) * radius, spread, Math.sin(angle) * radius);
    const hue = Math.random() < 0.22 ? 0.1 + Math.random() * 0.05 : 0.58 + Math.random() * 0.15;
    color.setHSL(hue, DUST.saturation, DUST.minLightness + Math.random() * DUST.lightnessRange);
    colors.push(color.r, color.g, color.b);
  }
  return points(positions, colors, new THREE.PointsMaterial({
    size: DUST.size, sizeAttenuation: true, map: glowTexture(), vertexColors: true,
    transparent: true, opacity: DUST.opacity, depthWrite: false, blending: THREE.AdditiveBlending
  }));
}

function glowSprite(color, scale, opacity, fog = true) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity,
    depthWrite: false, blending: THREE.AdditiveBlending, fog
  }));
  sprite.scale.setScalar(scale);
  return sprite;
}

let streak;

// A meteor's trail: bright at the right-hand end (the head), fading out to
// the left, soft across its width.
function streakTexture() {
  if (streak) return streak;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 16;
  const context = canvas.getContext("2d");
  const along = context.createLinearGradient(0, 0, 256, 0);
  along.addColorStop(0, "rgba(255,255,255,0)");
  along.addColorStop(0.7, "rgba(255,255,255,0.35)");
  along.addColorStop(1, "rgba(255,255,255,1)");
  context.fillStyle = along;
  context.fillRect(0, 0, 256, 16);
  context.globalCompositeOperation = "destination-in";
  const across = context.createLinearGradient(0, 0, 0, 16);
  across.addColorStop(0, "rgba(0,0,0,0)");
  across.addColorStop(0.5, "rgba(0,0,0,1)");
  across.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = across;
  context.fillRect(0, 0, 256, 16);
  streak = new THREE.CanvasTexture(canvas);
  streak.colorSpace = THREE.SRGBColorSpace;
  return streak;
}

// Now and then a meteor streaks across the part of the sky in view, beyond
// the tab stars.
function createMeteors(scene, camera) {
  const trail = new THREE.Sprite(new THREE.SpriteMaterial({
    map: streakTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
  }));
  trail.center.set(1, 0.5);
  const head = glowSprite(0xffffff, 3, 0, false);
  trail.visible = head.visible = false;
  scene.add(trail, head);

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  let meteor = null;
  let next = null;

  function launch(time) {
    camera.getWorldDirection(forward);
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    const spread = METEOR.distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const side = Math.random() < 0.5 ? -1 : 1;
    const start = camera.position.clone()
      .addScaledVector(forward, METEOR.distance)
      .addScaledVector(right, -side * spread * (0.1 + Math.random() * 0.8) * camera.aspect)
      .addScaledVector(up, spread * (0.2 + Math.random() * 0.7));
    const direction = right.clone().multiplyScalar(side * (0.6 + Math.random() * 0.5))
      .addScaledVector(up, -(0.45 + Math.random() * 0.5))
      .addScaledVector(forward, (Math.random() - 0.5) * 0.3)
      .normalize();
    const color = new THREE.Color(METEOR.colors[Math.floor(Math.random() * METEOR.colors.length)]);
    trail.material.color.copy(color);
    head.material.color.copy(color);
    meteor = {
      start: time,
      life: 0.6 + Math.random() * 0.6,
      speed: 90 + Math.random() * 70,
      length: 14 + Math.random() * 14,
      origin: start,
      direction
    };
    trail.visible = head.visible = true;
  }

  return {
    update(time) {
      if (next === null) next = time + 1.5 + Math.random() * 3;
      if (!meteor && time >= next) launch(time);
      if (!meteor) return;
      const age = (time - meteor.start) / meteor.life;
      if (age >= 1) {
        meteor = null;
        trail.visible = head.visible = false;
        next = time + METEOR.minGap + Math.random() * (METEOR.maxGap - METEOR.minGap);
        return;
      }
      const position = meteor.origin.clone().addScaledVector(meteor.direction, meteor.speed * meteor.life * age);
      trail.position.copy(position);
      head.position.copy(position);
      // Point the trail back along the path as it appears on screen.
      a.copy(position).project(camera);
      b.copy(position).addScaledVector(meteor.direction, 1).project(camera);
      trail.material.rotation = Math.atan2(b.y - a.y, (b.x - a.x) * camera.aspect);
      const fade = Math.min(1, age * 6) * (1 - Math.pow(age, 3));
      trail.scale.set(meteor.length * (0.4 + 0.6 * Math.min(1, age * 3)), 0.55, 1);
      trail.material.opacity = 0.9 * fade;
      head.material.opacity = fade;
    }
  };
}

// Everything in the scene that isn't a tab or the black hole (which has its
// own module): the galactic sky, stars, nebulae, the disc's dust and meteors.
export function createBackdrop(scene, camera) {
  const galaxy = createGalaxySky();
  const faintStars = createStars(3200, 1.8, [0.25, 0.6], 0.45);
  const brightStars = createStars(260, 3.4, [0.6, 0.4], 0.3);
  const dust = createDust();
  scene.add(galaxy, faintStars, brightStars, dust);

  NEBULAE.forEach((nebula) => {
    const sprite = glowSprite(nebula.color, nebula.scale, nebula.opacity, false);
    sprite.position.set(...nebula.position);
    scene.add(sprite);
  });

  const meteors = camera ? createMeteors(scene, camera) : null;

  return {
    update(time) {
      const drift = time * 0.004;
      galaxy.rotation.y = drift;
      faintStars.rotation.y = drift;
      brightStars.rotation.y = drift;
      // The bright stars twinkle gently.
      brightStars.material.size = 3.4 + Math.sin(time * 2.3) * 0.35;
      dust.rotation.y = time * 0.012;
      if (meteors) meteors.update(time);
    }
  };
}
