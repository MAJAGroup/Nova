import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { el } from "../../lib/dom.js";
import { createBackdrop } from "./backdrop.js";
import { createTabStars } from "./tab-stars.js";
import { createJourneyGraph } from "./journey-graph.js";

const SPACE_COLOR = 0x050813;
const CLICK_TOLERANCE = 5;

// A 3D view of every open tab as a star. It replaces the web page while open;
// choosing a star switches to that tab. The scene only renders while open.
export function createCosmosView({ browser, tabs, onVisibilityChange }) {
  const container = el("cosmos");
  let isOpen = false;
  let frame = 0;
  let activeMode = "tabs";
  let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let navigation = { tabs: [], visits: [], edges: [], events: [] };

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (_) {
    container.insertAdjacentHTML("afterbegin", '<p class="cosmos-unavailable">3D graphics are unavailable on this system.</p>');
  }

  function select(tab) {
    if (tabs.isActive(tab)) close();
    else browser.activateTab(tab.id);
  }

  let scene, camera, controls, labels, backdrop, stars, journeys;
  const modeHint = container.querySelector(".cosmos-hint");
  const emptyState = document.createElement("div");
  emptyState.className = "journey-empty";
  emptyState.textContent = "Your navigation journey will appear here as you visit pages.";
  container.append(emptyState);
  if (renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(SPACE_COLOR);
    renderer.domElement.className = "cosmos-canvas";
    labels = new CSS2DRenderer();
    labels.domElement.className = "cosmos-labels";
    container.prepend(renderer.domElement, labels.domElement);

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(SPACE_COLOR, 0.009);
    camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 6;
    controls.maxDistance = 160;
    controls.autoRotateSpeed = 0.35;
    controls.addEventListener("start", () => { controls.autoRotate = false; });

    backdrop = createBackdrop(scene);
    stars = createTabStars({ scene, camera, tabs, onSelect: select });
    journeys = createJourneyGraph({ scene, onSelect: (visit) => { browser.goToVisit(visit.id); close(); } });
    stars.setReducedMotion(reducedMotion);
    journeys.setReducedMotion(reducedMotion);
    bindPointer(renderer.domElement);
    new ResizeObserver(resize).observe(container);
  }

  tabs.subscribe(() => {
    const count = tabs.tabs.length;
    if (activeMode === "tabs") el("cosmos-count").textContent = count + (count === 1 ? " tab" : " tabs");
  });
  browser.getNavigation().then((snapshot) => updateNavigation(snapshot));
  browser.onNavigationUpdated((snapshot) => updateNavigation(snapshot));
  el("cosmos-open-tabs").addEventListener("click", () => setMode("tabs"));
  el("cosmos-journeys").addEventListener("click", () => setMode("journeys"));

  function updateNavigation(snapshot) {
    navigation = snapshot || navigation;
    if (journeys && isOpen && activeMode === "journeys") journeys.sync(navigation);
    if (activeMode === "journeys") updateModeText();
  }

  function updateModeText() {
    const journeyMode = activeMode === "journeys";
    el("cosmos-open-tabs").setAttribute("aria-pressed", String(!journeyMode));
    el("cosmos-journeys").setAttribute("aria-pressed", String(journeyMode));
    el("cosmos-count").textContent = journeyMode
      ? (navigation.visits || []).length + ((navigation.visits || []).length === 1 ? " visit" : " visits")
      : tabs.tabs.length + (tabs.tabs.length === 1 ? " tab" : " tabs");
    modeHint.textContent = journeyMode
      ? "Drag to orbit · Select a visit to return · Esc to leave"
      : "Drag to orbit · Scroll to zoom · Click a star to open · Esc to return";
    emptyState.hidden = !journeyMode || Boolean((navigation.visits || []).length);
  }

  function setMode(mode) {
    activeMode = mode === "journeys" ? "journeys" : "tabs";
    if (activeMode === "journeys" && journeys) journeys.sync(navigation);
    if (stars) stars.setVisible(activeMode === "tabs");
    if (journeys) journeys.setVisible(activeMode === "journeys");
    updateModeText();
    if (isOpen && controls) frameAll();
  }
  setMode("tabs");

  function bindPointer(canvas) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let down = null;

    function starAt(event) {
      const rect = canvas.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return stars.pick(raycaster);
    }

    canvas.addEventListener("pointermove", (event) => {
      if (down) return;
      const star = starAt(event);
      stars.setHovered(star);
      canvas.style.cursor = star ? "pointer" : "";
    });
    canvas.addEventListener("pointerleave", () => stars.setHovered(null));
    canvas.addEventListener("pointerdown", (event) => { down = { x: event.clientX, y: event.clientY }; });
    canvas.addEventListener("pointerup", (event) => {
      const wasClick = down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < CLICK_TOLERANCE;
      down = null;
      if (!wasClick) return;
      const star = starAt(event);
      if (star) select(star.tab);
    });
  }

  function resize() {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height);
    labels.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function frameAll() {
    // Look down on the disc at a steep angle so stars rarely line up
    // behind one another.
    const radius = activeMode === "journeys" && journeys ? journeys.radius() : (stars ? stars.radius() : 12);
    const distance = Math.max(24, radius * (activeMode === "journeys" ? 2.3 : 2.6));
    camera.position.set(0, distance * 0.8, distance * 0.7);
    controls.target.set(0, 0, 0);
    controls.autoRotate = !reducedMotion;
    controls.update();
  }

  function tick(now) {
    if (!isOpen) return;
    frame = requestAnimationFrame(tick);
    const time = now / 1000;
    controls.update();
    backdrop.update(time, reducedMotion);
    stars.update(time);
    journeys.update(time);
    renderer.render(scene, camera);
    labels.render(scene, camera);
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    container.hidden = false;
    onVisibilityChange(true);
    if (!renderer) return;
    if (activeMode === "journeys") journeys.sync(navigation);
    resize();
    frameAll();
    frame = requestAnimationFrame(tick);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    cancelAnimationFrame(frame);
    container.hidden = true;
    if (stars) stars.setHovered(null);
    onVisibilityChange(false);
  }

  return {
    open,
    close,
    toggle: () => (isOpen ? close() : open()),
    isOpen: () => isOpen,
    setReducedMotion(value) {
      reducedMotion = Boolean(value);
      if (stars) stars.setReducedMotion(reducedMotion);
      if (journeys) journeys.setReducedMotion(reducedMotion);
      if (controls) {
        controls.enableDamping = !reducedMotion;
        controls.autoRotate = isOpen && !reducedMotion;
      }
    }
  };
}
