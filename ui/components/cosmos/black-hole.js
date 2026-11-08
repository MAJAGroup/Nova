import * as THREE from "three";

// World units per Schwarzschild radius: the event horizon's size in the scene.
export const HORIZON = 0.3;
// In black-hole units (horizon = 1). Light is bent inside BOUND; beyond it
// rays are treated as straight.
const BOUND = 11;
const DISK_INNER = 2.6;
const DISK_OUTER = 7.5;
const FEED_DECAY = 3;
const WAVE_SECONDS = 0.9;

const vertexShader = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Traces each pixel's light ray backwards through Schwarzschild spacetime.
// The ray bends around the hole (h² term), so the far side of the accretion
// disk shows up as the arcs above and below the shadow, and rays that skim
// the photon sphere make the thin bright ring around it.
const fragmentShader = /* glsl */ `
  uniform vec3 uCamera;
  uniform mat4 uToClip;
  uniform float uTime;
  uniform float uFeed;
  varying vec3 vLocal;

  #define BOUND ${BOUND.toFixed(1)}
  #define DISK_IN ${DISK_INNER.toFixed(2)}
  #define DISK_OUT ${DISK_OUTER.toFixed(2)}
  #define TAU 6.28318530718

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  // Streaky gas, seamless around the full turn.
  float gas(float r, float th) {
    vec2 scale = vec2(7.0, 1.5);
    float a = fbm(vec2(r, th) * scale);
    float b = fbm(vec2(r, th - TAU) * scale);
    return mix(a, b, th / TAU);
  }

  vec4 disk(vec3 p, vec3 dir) {
    float r = length(p.xz);
    float omega = 1.6 / pow(r, 1.5);
    float th = mod(atan(p.z, p.x) - uTime * omega, TAU);
    float n = gas(r, th);
    float edge = smoothstep(DISK_IN, DISK_IN + 0.25, r) * (1.0 - smoothstep(DISK_IN + 1.2, DISK_OUT, r));
    float heat = pow(DISK_IN / r, 2.0);
    // Gas on the side swinging toward the camera is brighter.
    vec3 orbit = normalize(vec3(-p.z, 0.0, p.x));
    float doppler = 1.0 + 0.5 * dot(orbit, -dir) * sqrt(DISK_IN / r);
    vec3 cool = vec3(0.95, 0.42, 0.12);
    vec3 hot = vec3(1.0, 0.92, 0.8);
    vec3 color = mix(cool, hot, clamp(heat * 1.3, 0.0, 1.0));
    float glow = edge * (0.55 + 0.8 * n) * (0.25 + 3.2 * heat) * doppler * doppler * (1.0 + uFeed * 1.2);
    float alpha = clamp(edge * (0.35 + 0.5 * n) * (0.6 + heat), 0.0, 1.0);
    return vec4(color * glow, alpha);
  }

  void main() {
    vec3 dir = normalize(vLocal - uCamera);
    vec3 pos = uCamera;
    if (length(uCamera) > BOUND) {
      float b = dot(pos, dir);
      float h = b * b - (dot(pos, pos) - BOUND * BOUND);
      if (h < 0.0) discard;
      pos += dir * (-b - sqrt(h));
    }
    vec3 vel = dir;
    vec3 l = cross(pos, vel);
    float h2 = dot(l, l);

    vec3 color = vec3(0.0);
    float alpha = 0.0;
    vec3 hit = vec3(0.0);
    bool hasHit = false;
    float closest = 1e3;

    for (int i = 0; i < 300; i++) {
      float r = length(pos);
      float dt = clamp(0.07 * r, 0.015, 0.5);
      vec3 prev = pos;
      vel += -1.5 * h2 * pos / pow(r, 5.0) * dt;
      pos += vel * dt;

      if (prev.y * pos.y < 0.0) {
        vec3 p = mix(prev, pos, prev.y / (prev.y - pos.y));
        float pr = length(p.xz);
        if (pr > DISK_IN * 0.9 && pr < DISK_OUT) {
          vec4 s = disk(p, normalize(vel));
          color += (1.0 - alpha) * s.rgb * s.a;
          if (!hasHit && s.a > 0.1) { hit = p; hasHit = true; }
          alpha += (1.0 - alpha) * s.a;
        }
      }

      r = length(pos);
      closest = min(closest, r);
      if (r < 1.0) {
        if (!hasHit) { hit = pos; hasHit = true; }
        alpha = 1.0;
        break;
      }
      if (alpha > 0.995) break;
      if (r > BOUND + 0.5 && dot(pos, vel) > 0.0) break;
    }

    // Light that grazed the photon sphere on its way past.
    float ring = exp(-pow((closest - 1.55) * 9.0, 2.0)) * (1.0 - alpha);
    color += vec3(1.0, 0.85, 0.65) * ring * (0.9 + uFeed * 1.5);
    alpha = max(alpha, ring * 0.8);

    if (alpha < 0.01) discard;
    if (!hasHit) hit = pos;

    vec4 clip = uToClip * vec4(hit, 1.0);
    gl_FragDepth = clip.w > 0.0 ? clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0) : gl_FragCoord.z;
    gl_FragColor = vec4(1.0 - exp(-color * 1.3), alpha);
  }
`;

// A Gargantua-style black hole at the centre of the cosmos: a black shadow
// ringed by its lensed accretion disk, which lies in the plane of the tab
// stars. feed() makes the disk flare, for when a closed tab falls in.
export function createBlackHole(scene) {
  const uniforms = {
    uCamera: { value: new THREE.Vector3() },
    uToClip: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    uFeed: { value: 0 }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: true
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(BOUND, 48, 32), material);
  mesh.scale.setScalar(HORIZON);
  mesh.frustumCulled = false;
  const inverse = new THREE.Matrix4();
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    inverse.copy(mesh.matrixWorld).invert();
    uniforms.uCamera.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse);
    uniforms.uToClip.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(mesh.matrixWorld);
    material.uniformsNeedUpdate = true;
  };
  scene.add(mesh);

  // A ripple across the disk plane when something falls in.
  const wave = new THREE.Mesh(
    new THREE.RingGeometry(0.82, 1, 96),
    new THREE.MeshBasicMaterial({ color: 0xffc58a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  wave.rotation.x = -Math.PI / 2;
  wave.visible = false;
  scene.add(wave);
  let waveStart = null;
  let pendingWave = false;

  let lastTime = null;
  let lured = false;
  return {
    radius: HORIZON,
    diskRadius: DISK_OUTER * HORIZON,
    update(time) {
      const delta = lastTime === null ? 0 : Math.min(0.1, time - lastTime);
      lastTime = time;
      uniforms.uTime.value = time;
      uniforms.uFeed.value *= Math.exp(-delta * FEED_DECAY);
      if (lured) uniforms.uFeed.value = Math.max(uniforms.uFeed.value, 0.6 + Math.sin(time * 9) * 0.15);
      if (pendingWave) {
        pendingWave = false;
        waveStart = time;
      }
      wave.visible = waveStart !== null;
      if (waveStart !== null) {
        const t = (time - waveStart) / WAVE_SECONDS;
        if (t >= 1) {
          waveStart = null;
          wave.visible = false;
        } else {
          const eased = 1 - Math.pow(1 - t, 3);
          wave.scale.setScalar(HORIZON * (2 + eased * 18));
          wave.material.opacity = 0.7 * (1 - t) * (1 - t);
        }
      }
    },
    // Glows while a dragged star hovers over it, ready to be dropped in.
    lure(on) {
      lured = on;
    },
    feed(amount = 1) {
      uniforms.uFeed.value = Math.min(2.5, uniforms.uFeed.value + amount);
      pendingWave = true;
    }
  };
}
