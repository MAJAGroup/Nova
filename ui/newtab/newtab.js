import { normalizeAddress } from "../lib/url.js";

const canvas = document.getElementById("universe");
const context = canvas.getContext("2d", { alpha: false });
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const toggle = document.getElementById("motion-toggle");
let paused = false;
try { paused = localStorage.getItem("orbit.start.motionPaused") === "1"; } catch { /* Local storage may be disabled. */ }
let width = 0, height = 0, ratio = 1, frame = 0, last = 0, elapsed = 0;
let layers = [], planet, ringBack, ringFront;
const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
const running = () => !paused && !motion.matches && !document.hidden;

function random(seed) {
  return () => { seed = Math.imul(seed ^ seed >>> 15, 1 | seed); seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed); return ((seed ^ seed >>> 14) >>> 0) / 4294967296; };
}
function surface(size) {
  const image = document.createElement("canvas"); image.width = image.height = size; return image;
}
function makePlanet() {
  const size = 600, image = surface(size), ctx = image.getContext("2d");
  const pixels = ctx.createImageData(size, size), radius = size * .45;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x - size / 2) / radius, v = (y - size / 2) / radius;
    const distance = u * u + v * v;
    if (distance > 1) continue;
    const z = Math.sqrt(1 - distance);
    const light = Math.max(0, u * -.66 + v * -.46 + z * .59);
    const turbulence = Math.sin(u * 12 + v * 7) * .04 + Math.sin(u * 24 - v * 17) * .012;
    const bands = Math.sin((v + turbulence) * 86 + Math.sin(u * 8)) * .5 + .5;
    const clouds = Math.sin(u * 52 + v * 31 + Math.sin(v * 60)) * Math.sin(v * 115 - u * 29) * .5 + .5;
    const illumination = .035 + Math.pow(light, .8) * .86;
    const rim = Math.pow(1 - z, 3) * Math.pow(Math.max(0, light), .4);
    const index = (y * size + x) * 4;
    pixels.data[index] = (32 + bands * 31 + clouds * 7) * illumination + rim * 65;
    pixels.data[index + 1] = (78 + bands * 37 + clouds * 12) * illumination + rim * 133;
    pixels.data[index + 2] = (135 + bands * 48 + clouds * 16) * illumination + rim * 170;
    pixels.data[index + 3] = Math.min(255, (1 - Math.sqrt(distance)) * radius * 255);
  }
  ctx.putImageData(pixels, 0, 0);
  return image;
}
function makeRings(front) {
  const image = surface(1400), ctx = image.getContext("2d"), rand = random(806);
  ctx.translate(700, 700); ctx.rotate(-.37);
  for (let i = 0; i < 250; i++) {
    const r = 370 + i * 1.08;
    if (i > 125 && i < 140 || i > 204 && i < 212) continue;
    const alpha = (.13 + rand() * .23) * Math.sin(i / 250 * Math.PI) * (front ? 1 : .55);
    const warm = i < 115;
    ctx.strokeStyle = warm ? `rgba(191,174,152,${alpha})` : `rgba(132,164,193,${alpha})`;
    ctx.lineWidth = .65 + rand() * 1.2;
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * .29, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); ctx.stroke();
  }
  return image;
}
function makeStars(depth) {
  const image = document.createElement("canvas"), ctx = image.getContext("2d");
  image.width = Math.ceil((width + 100) * ratio); image.height = Math.ceil((height + 100) * ratio);
  ctx.scale(ratio, ratio);
  const rand = random(780 + depth * 43), count = Math.min(1100, Math.floor(width * height / (depth === 0 ? 2200 : 6500)));
  for (let i = 0; i < count; i++) {
    const x = rand() * (width + 100), y = rand() * (height + 100), size = .25 + rand() * (depth === 2 ? 1.3 : .7);
    const alpha = .15 + rand() * (depth === 2 ? .65 : .4);
    ctx.fillStyle = `rgba(${rand() > .25 ? "183,208,234" : "238,210,177"},${alpha})`;
    ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
    if (depth === 2 && i % 17 === 0) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 9); glow.addColorStop(0, "#b6deff45"); glow.addColorStop(1, "#b6deff00");
      ctx.fillStyle = glow; ctx.fillRect(x - 9, y - 9, 18, 18);
      ctx.fillStyle = "#cfe7ff66"; ctx.fillRect(x - 3, y - .25, 6, .5); ctx.fillRect(x - .25, y - 3, .5, 6);
    }
  }
  return image;
}
function glow(x, y, rx, ry, color) {
  context.save(); context.translate(x, y); context.scale(rx, ry);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1); gradient.addColorStop(0, color); gradient.addColorStop(1, "#00000000");
  context.fillStyle = gradient; context.fillRect(-1, -1, 2, 2); context.restore();
}
function draw() {
  if (!context || !planet) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = "#050a14"; context.fillRect(0, 0, width, height);
  const px = pointer.x, py = pointer.y;
  glow(width * .8 + px * 12, height * .44 + py * 8, width * .59, height * .72, "#253e613e");
  glow(width * .53 - px * 8, height * .82, width * .4, height * .45, "#392a5c22");
  glow(width * .97, height * .2, width * .36, height * .5, "#28475725");
  layers.forEach((layer, index) => {
    const depth = (index + 1) * 9;
    context.globalAlpha = .88 + Math.sin(elapsed * .3 + index) * .09;
    context.drawImage(layer, -50 + px * depth, -50 + py * depth, width + 100, height + 100);
  });
  context.globalAlpha = 1;
  const narrow = width < 600;
  const radius = Math.min(width * (narrow ? .25 : .158), height * (narrow ? .17 : .26), 230);
  const x = width * (narrow ? .78 : .785) + px * 20, y = height * (narrow ? .2 : .47) + py * 15;
  context.save(); context.translate(x, y); context.rotate(px * .025 + Math.sin(elapsed * .055) * .012);
  glow(-radius * .15, -radius * .16, radius * 1.65, radius * 1.65, "#80b9dc10");
  const scale = radius / 270;
  context.drawImage(ringBack, -700 * scale, -700 * scale, 1400 * scale, 1400 * scale);
  context.drawImage(planet, -radius / .9, -radius / .9, radius * 2 / .9, radius * 2 / .9);
  context.drawImage(ringFront, -700 * scale, -700 * scale, 1400 * scale, 1400 * scale);
  context.restore();
  // A small companion gives the space scene another layer of depth.
  const moonX = x - radius * 1.58 + px * 9, moonY = y - radius * 1.13 + py * 7;
  const moon = context.createRadialGradient(moonX - 2, moonY - 3, 0, moonX, moonY, radius * .065);
  moon.addColorStop(0, "#adc0d0"); moon.addColorStop(.5, "#4a617b"); moon.addColorStop(1, "#0c1729");
  context.fillStyle = moon; context.beginPath(); context.arc(moonX, moonY, radius * .065, 0, Math.PI * 2); context.fill();
}
function tick(now) {
  frame = 0;
  if (!running()) { last = 0; return; }
  const dt = last ? Math.min((now - last) / 1000, .05) : 0; last = now; elapsed += dt;
  const easing = 1 - Math.exp(-dt * 3.2);
  pointer.x += (pointer.targetX - pointer.x) * easing;
  pointer.y += (pointer.targetY - pointer.y) * easing;
  draw(); frame = requestAnimationFrame(tick);
}
function syncMotion() {
  cancelAnimationFrame(frame); frame = 0; last = 0;
  const still = paused || motion.matches;
  toggle.setAttribute("aria-pressed", String(still));
  toggle.setAttribute("aria-label", motion.matches ? "Animation disabled by reduced-motion preference" : paused ? "Resume animation" : "Pause animation");
  toggle.title = toggle.getAttribute("aria-label");
  toggle.disabled = motion.matches;
  document.querySelector(".interaction-hint").hidden = still;
  draw();
  if (context && running()) frame = requestAnimationFrame(tick);
}
function resize() {
  width = innerWidth; height = innerHeight; ratio = Math.min(devicePixelRatio || 1, 1.75);
  if (!context) return;
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  layers = [0, 1, 2].map(makeStars); draw();
}
window.addEventListener("pointermove", event => {
  if (!running() || event.pointerType === "touch") return;
  pointer.targetX = event.clientX / width * 2 - 1;
  pointer.targetY = event.clientY / height * 2 - 1;
}, { passive: true });
window.addEventListener("pointerout", event => { if (!event.relatedTarget) pointer.targetX = pointer.targetY = 0; });
window.addEventListener("resize", resize);
document.addEventListener("visibilitychange", syncMotion);
motion.addEventListener("change", syncMotion);
toggle.addEventListener("click", () => {
  paused = !paused;
  try { localStorage.setItem("orbit.start.motionPaused", paused ? "1" : "0"); } catch { /* Optional preference. */ }
  syncMotion();
});
document.getElementById("search-form").addEventListener("submit", event => {
  event.preventDefault(); const query = document.getElementById("start-search").value.trim();
  if (query) location.assign(normalizeAddress(query));
});
if (context) { planet = makePlanet(); ringBack = makeRings(false); ringFront = makeRings(true); }
resize(); syncMotion();
document.documentElement.dataset.startReady = "true";
