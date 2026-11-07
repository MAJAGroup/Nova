import * as THREE from "three";
import { glowTexture } from "./textures.js";

const SKY_COLORS = [0xffffff, 0xcfdcff, 0xa9c4ff, 0xffe2b8];
const NEBULAE = [
  { color: 0x3948aa, position: [-260, 80, -320], scale: 380, opacity: 0.22 },
  { color: 0x1c7f8e, position: [300, -60, -260], scale: 300, opacity: 0.16 },
  { color: 0x6b3fa0, position: [40, 160, 340], scale: 340, opacity: 0.14 },
  { color: 0x23306e, position: [-120, -200, 200], scale: 420, opacity: 0.18 }
];

function randomDirection() {
  const u = Math.random() * 2 - 1;
  const theta = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(s * Math.cos(theta), u, s * Math.sin(theta));
}

function points(positions, colors, material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Points(geometry, material);
}

// Distant stars on a sphere around everything, fixed-size on screen.
function createSky() {
  const positions = [];
  const colors = [];
  const color = new THREE.Color();
  for (let i = 0; i < 3000; i++) {
    const point = randomDirection().multiplyScalar(260 + Math.random() * 340);
    positions.push(point.x, point.y, point.z);
    color.setHex(SKY_COLORS[i % SKY_COLORS.length]).multiplyScalar(0.35 + Math.random() * 0.65);
    colors.push(color.r, color.g, color.b);
  }
  return points(positions, colors, new THREE.PointsMaterial({
    size: 2.2, sizeAttenuation: false, map: glowTexture(), vertexColors: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
  }));
}

// Faint dust in the plane where the tab stars live, so the disc reads as a galaxy.
function createDust() {
  const positions = [];
  const colors = [];
  const color = new THREE.Color();
  for (let i = 0; i < 1800; i++) {
    const radius = 3 + Math.pow(Math.random(), 0.7) * 55;
    const angle = Math.random() * Math.PI * 2;
    const spread = (Math.random() + Math.random() - 1) * (1 + radius * 0.06);
    positions.push(Math.cos(angle) * radius, spread, Math.sin(angle) * radius);
    color.setHSL(0.58 + Math.random() * 0.15, 0.6, 0.35 + Math.random() * 0.3);
    colors.push(color.r, color.g, color.b);
  }
  return points(positions, colors, new THREE.PointsMaterial({
    size: 0.35, sizeAttenuation: true, map: glowTexture(), vertexColors: true,
    transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending
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

// Everything in the scene that isn't a tab: sky, nebulae, galactic dust and
// the bright core at the centre.
export function createBackdrop(scene) {
  const sky = createSky();
  const dust = createDust();
  scene.add(sky, dust);

  NEBULAE.forEach((nebula) => {
    const sprite = glowSprite(nebula.color, nebula.scale, nebula.opacity, false);
    sprite.position.set(...nebula.position);
    scene.add(sprite);
  });

  const core = new THREE.Group();
  const coreHalo = glowSprite(0x7f95ff, 10, 0.45);
  core.add(glowSprite(0xe6ecff, 2.6, 1), coreHalo);
  scene.add(core);

  return {
    update(time, reducedMotion = false) {
      sky.rotation.y = reducedMotion ? 0 : time * 0.004;
      dust.rotation.y = reducedMotion ? 0 : time * 0.012;
      coreHalo.scale.setScalar(reducedMotion ? 10 : 10 + Math.sin(time * 1.3) * 0.8);
    }
  };
}
