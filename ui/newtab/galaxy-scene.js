import { createGalaxyParticles, GALAXY_STRIDE } from "./galaxy-model.mjs";

// A point-cloud galaxy with an expanding acquisition front, differential
// rotation, a central bar, stellar knots, depth softening and a dusty midplane.
// The reference was inspected for visual behavior; this renderer is independent.
const vertexSource = `
precision highp float;
attribute vec4 aOrbit;
attribute vec3 aLook;
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uTime;
uniform float uReveal;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vAlpha;
varying float vSoft;
void main() {
  float radius = aOrbit.x;
  float population = aLook.z;
  float speed = population > 0.5 && population < 1.5 ? 0.049 : 0.075 / (1.0 + radius * 2.7);
  float angle = aOrbit.y + uTime * speed;
  vec3 p = vec3(cos(angle) * radius, aOrbit.z, sin(angle) * radius);
  float elevation = 0.178 + uPointer.y * 0.025 + sin(uTime * 0.027) * 0.008;
  float y = p.y * cos(elevation) - p.z * sin(elevation);
  float depth = p.z * cos(elevation) + p.y * sin(elevation);
  float perspective = 3.4 / (3.4 + depth * 0.72);
  float roll = -0.044 + uPointer.x * 0.018;
  vec2 plane = mat2(cos(roll), sin(roll), -sin(roll), cos(roll)) * vec2(p.x, y);
  bool portrait = uResolution.x < 650.0;
  float scale = uResolution.x * (portrait ? 0.48 : 0.355);
  vec2 center = uResolution * vec2(0.5, portrait ? 0.475 : 0.53) + uPointer * vec2(12.0, 8.0);
  vec2 pixel = center + vec2(plane.x, -plane.y) * scale * perspective;
  gl_Position = vec4(pixel / uResolution * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y *= -1.0;
  float front = uReveal * 1.8;
  float distanceFromCore = length(vec2(radius, p.y * 1.8));
  float acquired = smoothstep(distanceFromCore - 0.035, distanceFromCore + 0.035, front);
  float flare = exp(-pow((distanceFromCore - front) / 0.045, 2.0)) * (1.0 - step(0.999, uReveal));
  float dust = exp(-pow((y + p.x * 0.009) / (0.011 + abs(p.x) * 0.012), 2.0));
  dust *= smoothstep(-0.2, 0.26, depth) * exp(-abs(p.x) * 0.75);
  float wave = 0.9 + 0.1 * sin(uTime * 0.7 - radius * 15.0 + aLook.y * 12.0);
  float pulse = population > 2.5 ? 0.78 + 0.22 * sin(uTime * 0.8 + aLook.y * 30.0) : wave;
  float shade = (1.0 - dust * 0.94) * (population > 1.5 && population < 2.5 ? 0.7 : 1.0);
  vAlpha = aOrbit.w * acquired * shade * pulse * (0.78 + flare * 1.1);
  vec3 cyan = vec3(0.40, 0.79, 0.89);
  vec3 blue = vec3(0.43, 0.55, 0.88);
  vec3 pearl = vec3(0.80, 0.94, 0.98);
  vColor = mix(cyan, blue, smoothstep(0.15, 1.0, radius) * 0.6);
  vColor = mix(vColor, pearl, (1.0 - smoothstep(0.0, 0.25, radius)) * 0.74);
  if (population > 2.5) vColor = mix(vec3(0.62, 0.60, 0.94), cyan, aLook.y);
  vColor = mix(vColor, pearl, flare * 0.6);
  vSoft = smoothstep(0.1, 1.3, abs(depth)) * 0.3;
  gl_PointSize = clamp((aLook.x + vSoft * 1.8 + flare * 0.8) * uPixelRatio * perspective, 1.0, 5.5 * uPixelRatio);
}`;
const fragmentSource = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
varying float vSoft;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0 || vAlpha < 0.001) discard;
  float core = exp(-r * r * (5.0 - vSoft * 4.0));
  float halo = exp(-r * r * 1.4) * 0.1;
  gl_FragColor = vec4(vColor, vAlpha * (core + halo));
}`;

export function createGalaxyScene(canvas) {
  const count = innerWidth < 650 || navigator.hardwareConcurrency <= 4 ? 85000 : 180000;
  const particles = createGalaxyParticles(count);
  let gl;
  try { gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, powerPreference: "low-power", preserveDrawingBuffer: true }); } catch { /* Use the canvas fallback. */ }
  let program, buffer, uniforms, lost = false;
  function initialize() {
    const shaders = [];
    try {
      for (const [kind, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
        const shader = gl.createShader(kind); shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("Galaxy shader compilation failed");
      }
      program = gl.createProgram(); shaders.forEach(shader => gl.attachShader(program, shader)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Galaxy program linking failed");
      gl.useProgram(program);
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, particles, gl.STATIC_DRAW);
      const orbit = gl.getAttribLocation(program, "aOrbit"), look = gl.getAttribLocation(program, "aLook");
      gl.enableVertexAttribArray(orbit); gl.vertexAttribPointer(orbit, 4, gl.FLOAT, false, GALAXY_STRIDE * 4, 0);
      gl.enableVertexAttribArray(look); gl.vertexAttribPointer(look, 3, gl.FLOAT, false, GALAXY_STRIDE * 4, 16);
      uniforms = Object.fromEntries(["uResolution", "uPointer", "uTime", "uReveal", "uPixelRatio"].map(name => [name, gl.getUniformLocation(program, name)]));
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.disable(gl.DEPTH_TEST);
      canvas.dataset.renderer = "webgl";
    } finally { shaders.forEach(shader => gl.deleteShader(shader)); }
  }
  if (gl) {
    try { initialize(); }
    catch { if (program) gl.deleteProgram(program); if (buffer) gl.deleteBuffer(buffer); canvas.dataset.renderer = "unavailable"; document.body.classList.add("galaxy-fallback"); gl = null; }
  }
  // A smaller point cloud keeps new tabs useful without WebGL, including on
  // machines where GPU acceleration has been disabled.
  const fallback = gl ? null : canvas.getContext("2d", { alpha: false });
  if (fallback) canvas.dataset.renderer = "canvas";
  function fallbackFrame({ width, height, ratio, time, x, y, reveal }) {
    fallback.setTransform(ratio, 0, 0, ratio, 0, 0);
    fallback.fillStyle = "#050a14"; fallback.fillRect(0, 0, width, height);
    const radius = width * (width < 650 ? .48 : .355), centerY = height * (width < 650 ? .475 : .53);
    for (let i = 0; i < count; i += 18) {
      const offset = i * GALAXY_STRIDE, r = particles[offset];
      if (r > reveal * 1.8) continue;
      const a = particles[offset + 1] + time * .06 / (1 + r * 2.7);
      const px = Math.cos(a) * r, pz = Math.sin(a) * r;
      const py = particles[offset + 2] - pz * (.178 + y * .025);
      const alpha = particles[offset + 3] * .55 * (Math.abs(py) < .012 && pz > 0 ? .12 : 1);
      fallback.fillStyle = `rgba(153,213,235,${alpha})`;
      fallback.fillRect(width * .5 + px * radius + x * 12, centerY - (py - px * .044) * radius + y * 8, 1.1, 1.1);
    }
  }
  function render(options) {
    if (lost) return;
    const { width, height, ratio, time, x, y, reveal } = options;
    if (gl) {
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(5 / 255, 10 / 255, 20 / 255, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program); gl.uniform2f(uniforms.uResolution, width, height); gl.uniform2f(uniforms.uPointer, x, y);
      gl.uniform1f(uniforms.uTime, time); gl.uniform1f(uniforms.uReveal, reveal); gl.uniform1f(uniforms.uPixelRatio, ratio);
      gl.drawArrays(gl.POINTS, 0, width < 650 ? Math.min(85000, count) : count);
    } else if (fallback) fallbackFrame(options);
  }
  canvas.addEventListener("webglcontextlost", event => { event.preventDefault(); lost = true; canvas.dataset.renderer = "lost"; });
  canvas.addEventListener("webglcontextrestored", () => {
    if (!gl) return;
    try { initialize(); lost = false; window.dispatchEvent(new Event("galaxy-restored")); }
    catch { document.body.classList.add("galaxy-fallback"); canvas.dataset.renderer = "unavailable"; }
  });
  return { render, available: Boolean(gl || fallback), count };
}
