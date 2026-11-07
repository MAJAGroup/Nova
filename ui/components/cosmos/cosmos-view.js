import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { el, escapeHTML } from "../../lib/dom.js";
import { domainOf } from "../../lib/url.js";
import { createBackdrop } from "./backdrop.js";
import { createTabStars } from "./tab-stars.js";
import { createConstellations } from "./constellations.js";

const SPACE_COLOR = 0x050813;
const CLICK_TOLERANCE = 5;
const CAMERA_GLIDE = 4;

// A 3D view of every open tab as a star, with tab groups drawn as
// constellations. It replaces the web page while open; choosing a star
// switches to that tab. The scene only renders while open.
//
// Click a star to open it, shift-click to select several and group them,
// right-click for the group menu. Click a constellation's name to fly to it,
// double-click to rename it, double-click empty space to see everything.
export function createCosmosView({ browser, tabs, onVisibilityChange }) {
  const container = el("cosmos");
  const stage = el("cosmos-stage");
  const tabList = el("cosmos-tab-list");
  const selectionBar = el("cosmos-selection");
  let isOpen = false;
  let frame = 0;
  let flight = null;
  let lastTime = null;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (_) {
    stage.insertAdjacentHTML("afterbegin", '<p class="cosmos-unavailable">3D graphics are unavailable on this system.</p>');
  }

  function select(tab, event) {
    if (event && event.shiftKey) {
      stars.toggleSelected(tab.id);
      updateSelectionBar();
    } else if (tabs.isActive(tab)) {
      close();
    } else {
      browser.activateTab(tab.id);
    }
  }

  let scene, camera, controls, labels, backdrop, stars, constellations;
  if (renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(SPACE_COLOR);
    renderer.domElement.className = "cosmos-canvas";
    labels = new CSS2DRenderer();
    labels.domElement.className = "cosmos-labels";
    stage.prepend(renderer.domElement, labels.domElement);
    // Tab icons and constellation names sit in an HTML layer above the
    // canvas, so scrolling over them would never reach the camera controls.
    labels.domElement.addEventListener("wheel", (event) => {
      event.preventDefault();
      renderer.domElement.dispatchEvent(new WheelEvent("wheel", event));
    }, { passive: false });

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(SPACE_COLOR, 0.009);
    camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 6;
    controls.maxDistance = 160;
    controls.autoRotateSpeed = 0.35;
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
      flight = null;
    });

    backdrop = createBackdrop(scene);
    constellations = createConstellations({
      scene,
      camera,
      tabs,
      positionOf: (id) => stars.positionOf(id),
      onFocus: flyToGroup,
      onRename: (groupId, name) => browser.renameGroup(groupId, name)
    });
    stars = createTabStars({
      scene,
      camera,
      tabs,
      onSelect: select,
      onContextMenu: (tab) => browser.showTabMenu(tab.id),
      onLayout: (layout) => constellations.sync(layout)
    });
    bindPointer(renderer.domElement);
    new ResizeObserver(resize).observe(stage);
  }

  tabs.subscribe(() => {
    const count = tabs.tabs.length;
    const groups = tabs.groups.length;
    el("cosmos-count").textContent = count + (count === 1 ? " tab" : " tabs") +
      (groups ? " · " + groups + (groups === 1 ? " constellation" : " constellations") : "");
    if (stars) updateSelectionBar();
    renderTabList();
  });

  function renderTabList() {
    const grouped = new Map(tabs.groups.map((group) => [String(group.id), []]));
    const loose = [];
    for (const tab of tabs.tabs) {
      const group = tabs.groupOf(tab);
      if (group && grouped.has(String(group.id))) grouped.get(String(group.id)).push(tab);
      else loose.push(tab);
    }

    const sections = [];
    for (const group of tabs.groups) {
      const members = grouped.get(String(group.id)) || [];
      if (members.length) sections.push(renderSection(group.name, group.color, members, group.id));
    }
    if (loose.length) sections.push(renderSection("Unsorted", "#7786a8", loose));
    if (!sections.length) {
      const empty = document.createElement("div");
      empty.className = "cosmos-list-empty";
      empty.innerHTML = '<span class="cosmos-empty-orbit">✦</span><span>No tabs in orbit yet</span><small>Open a page to add its star to the atlas.</small>';
      sections.push(empty);
    }
    tabList.replaceChildren(...sections);
  }

  function renderSection(name, color, members, groupId) {
    const section = document.createElement("section");
    section.className = "cosmos-list-group";
    section.style.setProperty("--group-color", color);
    const heading = document.createElement("button");
    heading.type = "button";
    heading.className = "cosmos-group-heading";
    heading.innerHTML = '<span class="cosmos-group-dot"></span><span class="cosmos-group-name">' + escapeHTML(name) + '</span><span class="cosmos-group-count">' + members.length + '</span>';
    heading.title = groupId ? "Focus this constellation" : "Tabs without a constellation";
    if (groupId) heading.addEventListener("click", () => flyToGroup(groupId));
    section.appendChild(heading);

    for (const tab of members) {
      const item = document.createElement("button");
      const domain = domainOf(tab.url);
      const mark = tab.favicon
        ? '<img src="' + escapeHTML(tab.favicon) + '" alt="">'
        : escapeHTML(domain.slice(0, 1).toUpperCase() || "✦");
      item.type = "button";
      item.className = "cosmos-info-tab" + (tabs.isActive(tab) ? " active" : "");
      item.title = (tab.title || "New tab") + "\n" + (tab.url || "No address");
      item.innerHTML = '<span class="cosmos-info-favicon">' + mark + '</span><span class="cosmos-info-copy"><span class="cosmos-info-title">' + escapeHTML(tab.title || "New tab") + '</span><span class="cosmos-info-url">' + escapeHTML(tab.url || domain || "New tab") + '</span></span><span class="cosmos-info-active"></span>';
      item.addEventListener("click", () => browser.activateTab(tab.id));
      item.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        browser.showTabMenu(tab.id);
      });
      section.appendChild(item);
    }
    return section;
  }

  el("cosmos-group").addEventListener("click", async () => {
    const ids = stars.selectedIds();
    if (!ids.length) return;
    const groupId = await browser.groupTabs(ids);
    stars.clearSelection();
    updateSelectionBar();
    if (groupId) constellations.editName(groupId);
  });
  el("cosmos-clear-selection").addEventListener("click", () => {
    stars.clearSelection();
    updateSelectionBar();
  });

  function updateSelectionBar() {
    const count = stars.selectedIds().length;
    selectionBar.hidden = count === 0;
    el("cosmos-selection-count").textContent = count + (count === 1 ? " tab selected" : " tabs selected");
  }

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
    canvas.addEventListener("pointerdown", (event) => { down = { x: event.clientX, y: event.clientY, button: event.button }; });
    canvas.addEventListener("pointerup", (event) => {
      const wasClick = down && down.button === 0 && Math.hypot(event.clientX - down.x, event.clientY - down.y) < CLICK_TOLERANCE;
      down = null;
      if (!wasClick) return;
      const star = starAt(event);
      if (star) select(star.tab, event);
    });
    canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const star = starAt(event);
      if (star) browser.showTabMenu(star.tab.id);
    });
    canvas.addEventListener("dblclick", (event) => {
      if (!starAt(event)) flyHome();
    });
  }

  function resize() {
    const { width, height } = stage.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height);
    labels.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  // Looking down on the galaxy at a steep angle so stars rarely line up
  // behind one another.
  function overview() {
    const distance = Math.max(24, stars.extent() * 2.1);
    controls.maxDistance = Math.max(160, distance * 1.6);
    scene.fog.density = 0.6 / distance;
    return { target: new THREE.Vector3(), camera: new THREE.Vector3(0, distance * 0.8, distance * 0.7) };
  }

  function frameAll() {
    const view = overview();
    camera.position.copy(view.camera);
    controls.target.copy(view.target);
    controls.autoRotate = true;
    controls.update();
  }

  function flyHome() {
    flight = overview();
  }

  function flyToGroup(groupId) {
    const center = constellations.centerOf(groupId);
    if (!center) return;
    const distance = Math.max(16, constellations.radiusOf(groupId) * 3.4 + 8);
    const direction = camera.position.clone().sub(controls.target).normalize();
    flight = { target: center, camera: center.clone().add(direction.multiplyScalar(distance)) };
    controls.autoRotate = false;
  }

  function tick(now) {
    if (!isOpen) return;
    frame = requestAnimationFrame(tick);
    const time = now / 1000;
    const delta = lastTime === null ? 0 : Math.min(0.1, time - lastTime);
    lastTime = time;
    if (flight) {
      const step = 1 - Math.exp(-delta * CAMERA_GLIDE);
      controls.target.lerp(flight.target, step);
      camera.position.lerp(flight.camera, step);
      if (camera.position.distanceTo(flight.camera) < 0.05) flight = null;
    }
    controls.update();
    backdrop.update(time);
    stars.update(time);
    constellations.update(time);
    renderer.render(scene, camera);
    labels.render(scene, camera);
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    container.hidden = false;
    onVisibilityChange(true);
    if (!renderer) return;
    resize();
    frameAll();
    lastTime = null;
    frame = requestAnimationFrame(tick);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    cancelAnimationFrame(frame);
    flight = null;
    container.hidden = true;
    if (stars) {
      stars.setHovered(null);
      stars.clearSelection();
      updateSelectionBar();
    }
    onVisibilityChange(false);
  }

  return {
    open,
    close,
    toggle: () => (isOpen ? close() : open()),
    isOpen: () => isOpen,
    // Returns true when there was a selection to clear.
    clearSelection() {
      if (!stars || !stars.clearSelection()) return false;
      updateSelectionBar();
      return true;
    },
    renameGroup(groupId) {
      open();
      if (constellations) {
        flyToGroup(groupId);
        constellations.editName(groupId);
      }
    }
  };
}
