import { normalizeAddress } from "../lib/url.js";
import { createSearchSuggestions } from "../components/search-suggestions.js";
import { createGalaxyScene } from "./galaxy-scene.js";

const canvas = document.getElementById("universe");
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const toggle = document.getElementById("motion-toggle");
const galaxy = createGalaxyScene(canvas);
let paused = false;
try { paused = localStorage.getItem("orbit.start.motionPaused") === "1"; } catch { /* Optional local preference. */ }
let width = 0, height = 0, ratio = 1, frame = 0, last = 0, elapsed = motion.matches ? 3.2 : 0;
const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
const running = () => !paused && !motion.matches && !document.hidden && galaxy.available;

function draw() {
  const reveal = motion.matches ? 1 : Math.min(1, elapsed / 3.2);
  galaxy.render({ width, height, ratio, time: elapsed, x: pointer.x, y: pointer.y, reveal });
  canvas.dataset.phase = reveal >= 1 ? "revealed" : "appearing";
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
  toggle.title = toggle.getAttribute("aria-label"); toggle.disabled = motion.matches || !galaxy.available;
  document.querySelector(".interaction-hint").hidden = still;
  draw(); if (running()) frame = requestAnimationFrame(tick);
}
function resize() {
  width = innerWidth; height = innerHeight; ratio = Math.min(devicePixelRatio || 1, 1.75);
  canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio)); draw();
}
window.addEventListener("pointermove", event => {
  if (!running() || event.pointerType === "touch") return;
  pointer.targetX = event.clientX / Math.max(1, width) * 2 - 1;
  pointer.targetY = event.clientY / Math.max(1, height) * 2 - 1;
}, { passive: true });
window.addEventListener("pointerout", event => { if (!event.relatedTarget) pointer.targetX = pointer.targetY = 0; });
window.addEventListener("resize", resize);
window.addEventListener("galaxy-restored", syncMotion);
document.addEventListener("visibilitychange", syncMotion);
motion.addEventListener("change", () => { if (motion.matches) elapsed = Math.max(3.2, elapsed); syncMotion(); });
toggle.addEventListener("click", () => {
  paused = !paused;
  try { localStorage.setItem("orbit.start.motionPaused", paused ? "1" : "0"); } catch { /* Optional local preference. */ }
  syncMotion();
});
if (window.orbitSearch) {
  const bridge = window.orbitSearch;
  createSearchSuggestions({
    input: document.getElementById("start-search"), popup: document.getElementById("start-suggestions"),
    requestLocal: query => bridge.getLocalSuggestions(query), requestWeb: query => bridge.getWebSuggestions(query),
    cancelRequests: () => bridge.cancelSuggestions(), onCommit: item => { void bridge.chooseSuggestion(item); }
  });
}
document.getElementById("search-form").addEventListener("submit", event => {
  event.preventDefault(); const query = document.getElementById("start-search").value.trim();
  if (query) location.assign(normalizeAddress(query));
});
resize(); syncMotion();
document.documentElement.dataset.startReady = "true";
