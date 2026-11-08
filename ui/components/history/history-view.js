import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { createConstellations } from "../cosmos/constellations.js";
import { createBackdrop } from "../cosmos/backdrop.js";
import { createTabStars } from "../cosmos/tab-stars.js";
import { dateKey, dateLabel, clock, historyLayout } from "./history-layout.mjs";

function node(tag, className, text) {
  const element = document.createElement(tag); element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
const host = url => { try { return new URL(url).hostname; } catch { return url; } };

export function createHistoryView({ browser, onVisibilityChange }) {
  const root = document.getElementById("history");
  const stage = root.querySelector(".history-stage");
  const sidebar = root.querySelector(".history-visits");
  const dates = root.querySelector(".history-dates");
  const search = root.querySelector(".history-search");
  const details = root.querySelector(".history-details");
  const title = root.querySelector(".history-period");
  const empty = root.querySelector(".history-empty");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let visits = [], selected = null, day = "all", visible = [], groups = [];
  let shape = historyLayout([]);
  let openState = false, frame = 0, renderer, camera, controls, labels, stars, backdrop;
  let constellations, arrows = [], flight = null, lastTime = null;
  const listeners = new Set();
  const store = {
    get tabs() { return visible.map(v => ({ ...v, groupId: shape?.groupOf.get(v.id) })); },
    get groups() { return groups; },
    groupOf: tab => groups.find(g => g.id === tab.groupId),
    isActive: tab => tab.id === selected,
    subscribe(callback) { listeners.add(callback); callback(); return () => listeners.delete(callback); }
  };
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x050813);
  scene.fog = new THREE.FogExp2(0x050813, .004);
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
  catch { root.classList.add("history-no-webgl"); }
  if (renderer) {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.domElement.className = "cosmos-canvas";
    labels = new CSS2DRenderer(); labels.domElement.className = "cosmos-labels";
    stage.prepend(renderer.domElement, labels.domElement);
    camera = new THREE.PerspectiveCamera(55, 1, .1, 10000);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = !motion.matches; controls.autoRotateSpeed = .35;
    controls.enableDamping = !motion.matches; controls.dampingFactor = .08;
    controls.zoomToCursor = true; controls.minDistance = 2.5; controls.maxDistance = 4000;
    controls.addEventListener("start", () => { flight = null; setOrbit(false); });
    labels.domElement.addEventListener("wheel", event => {
      event.preventDefault(); renderer.domElement.dispatchEvent(new WheelEvent("wheel", event));
    }, { passive: false });
    backdrop = createBackdrop(scene, camera);
    constellations = createConstellations({ scene, camera, tabs: store,
      positionOf: id => stars?.positionOf(id), onFocus: focusGroup });
    stars = createTabStars({ scene, camera, tabs: store,
      onSelect: visit => select(visit.id), onContextMenu: visit => select(visit.id),
      reducedMotion: () => motion.matches,
      layout: { compute() {
        const positions = new Map([...shape.positions].map(([id, p]) => [id, new THREE.Vector3(p.x, p.y, p.z)]));
        const clusters = new Map(groups.map(g => [g.id, { ...g, center: new THREE.Vector3(g.center.x, g.center.y, g.center.z) }]));
        return { stars: positions, constellations: clusters, extent: Math.max(12, ...[...positions.values()].map(p => p.length())) };
      }}, onLayout: layout => { constellations.sync(layout); drawTrails(); }
    });
    // The star component shares Orbit view's icon labels and hover behavior.
    labels.domElement.addEventListener("dblclick", event => {
      const label = event.target.closest(".star-label");
      if (label && selected) openVisit(selected);
    });
    const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(); let down;
    function hit(event) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      ray.setFromCamera(pointer, camera); return stars.pick(ray);
    }
    renderer.domElement.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener("pointerup", e => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) { const star = hit(e); if (star) select(star.id); }
      down = null;
    });
    renderer.domElement.addEventListener("pointermove", e => { if (!down) stars.setHovered(hit(e)); });
    renderer.domElement.addEventListener("pointerleave", () => stars.setHovered(null));
    renderer.domElement.addEventListener("dblclick", e => { const star = hit(e); if (star) openVisit(star.id); else fit(); });
  }
  function drawTrails() {
    for (const item of arrows) { scene.remove(item.arrow); item.arrow.dispose(); } arrows = [];
    if (!shape) return;
    const ids = new Set(visible.map(v => v.id));
    for (const visit of visible) {
      if (!ids.has(visit.parent)) continue;
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0x698aa4, 1, .55);
      arrow.line.material.transparent = true; arrow.line.material.opacity = .6;
      arrow.cone.material.transparent = true; arrow.cone.material.opacity = .8;
      scene.add(arrow); arrows.push({ arrow, from: visit.parent, to: visit.id, kind: visit.kind });
    }
  }
  function focusGroup(id) {
    if (!renderer) return;
    const group = groups.find(g => g.id === id);
    if (!group) return;
    const center = new THREE.Vector3(group.center.x, group.center.y, group.center.z);
    const distance = Math.max(24, (group.radius + 8) * 2.5 / Math.min(1, camera.aspect));
    flight = { target: center, offset: new THREE.Vector3(0, distance * .8, distance * .7) };
    setOrbit(false);
  }
  function pathTo(id) {
    const ancestors = new Set(); const byId = new Map(visits.map(v => [v.id, v]));
    while (id && !ancestors.has(id)) { ancestors.add(id); id = byId.get(id)?.parent; }
    return ancestors;
  }
  function select(id, focus = false) {
    selected = id; listeners.forEach(callback => callback()); renderSidebar(); showDetails();
    if (focus && renderer) {
      const p = shape.positions.get(id); if (p) {
        const distance = Math.min(45, camera.position.distanceTo(controls.target));
        flight = { target: new THREE.Vector3(p.x, p.y, p.z), offset: new THREE.Vector3(0, distance * .8, distance * .7) };
        setOrbit(false);
      }
    }
  }
  async function openVisit(id) { if (await browser.openHistory(id)) close(); }
  function showDetails() {
    details.replaceChildren(); const visit = visits.find(v => v.id === selected);
    details.hidden = !visit; if (!visit) return;
    const top = node("div", "history-detail-heading");
    top.append(node("span", "cosmos-title", "VISIT DETAILS"));
    const dismiss = node("button", "history-quiet", "×"); dismiss.setAttribute("aria-label", "Close visit details");
    dismiss.onclick = () => { selected = null; refresh(false); }; top.append(dismiss);
    details.append(top, node("h2", "", visit.title || host(visit.url)), node("p", "history-detail-url", visit.url), node("p", "history-detail-time", `${dateLabel(dateKey(visit.at))} · ${clock(visit.at)}`));
    const open = node("button", "history-open", visit.liveTabId ? "Return to open tab ↗" : "Reopen this page ↗"); open.onclick = () => openVisit(visit.id); details.append(open);
    const linked = [visits.find(v => v.id === visit.parent), ...visits.filter(v => v.parent === visit.id)].filter(Boolean);
    if (linked.length) details.append(node("h3", "cosmos-title", "CONNECTED VISITS"));
    for (const v of linked.slice(0, 8)) {
      const relation = v.id === visit.parent ? "From" : v.kind === "new-tab" ? "New tab" : "To";
      const button = node("button", "history-related", `${relation} · ${clock(v.at)} · ${v.title || host(v.url)}`);
      button.onclick = () => { day = "all"; search.value = ""; selected = v.id; refresh(true); select(v.id, true); }; details.append(button);
    }
    details.append(node("p", "history-note", "Saved visit information. Reopening loads the current version of the page."));
  }
  function renderSidebar() {
    const focused = document.activeElement?.dataset.visitId;
    sidebar.replaceChildren();
    for (const group of [...groups].reverse()) {
      const section = node("section", "cosmos-list-group");
      section.style.setProperty("--group-color", group.color);
      const heading = node("button", "cosmos-group-heading");
      heading.append(node("span", "cosmos-group-dot"), node("span", "cosmos-group-name", group.name), node("span", "cosmos-group-count", String(group.memberIds.length)));
      heading.title = `${group.name} · Focus navigation journey`;
      heading.onclick = () => focusGroup(group.id); section.append(heading);
      const ids = new Set(group.memberIds);
      for (const visit of visible.filter(v => ids.has(v.id)).sort((a, b) => a.at - b.at)) {
        const button = node("button", "cosmos-info-tab" + (visit.id === selected ? " active" : "")); button.dataset.visitId = visit.id;
        button.title = `${visit.title}\n${visit.url}\n${new Date(visit.at).toLocaleString()}`;
        const time = node("span", "history-visit-clock");
        if (day === "all") time.append(node("small", "", new Date(visit.at).toLocaleDateString([], { month: "short", day: "numeric" })));
        time.append(node("span", "", clock(visit.at))); button.append(time);
        const copy = node("span", "cosmos-info-copy"); copy.append(node("span", "cosmos-info-title", visit.title || host(visit.url)), node("span", "cosmos-info-url", host(visit.url) + (visit.liveTabId ? " · Open tab" : "")));
        const mark = node("span", "cosmos-info-favicon");
        if (visit.favicon) {
          const image = document.createElement("img"); image.src = visit.favicon; image.alt = ""; mark.append(image);
        } else mark.textContent = host(visit.url).slice(0, 1).toUpperCase();
        button.append(mark, copy); button.onclick = () => select(visit.id, true); button.ondblclick = () => openVisit(visit.id);
        section.append(button);
      }
      sidebar.append(section);
    }
    if (focused) sidebar.querySelector(`[data-visit-id="${focused}"]`)?.focus({ preventScroll: true });
  }
  function refresh(refit = false) {
    if (!openState) return;
    const keys = [...new Set(visits.map(v => dateKey(v.at)))].sort().reverse();
    if (day !== "all" && !keys.includes(day)) day = keys[0] || "all";
    dates.replaceChildren();
    const all = node("button", "history-date" + (day === "all" ? " active" : ""), "All dates"); all.onclick = () => { day = "all"; refresh(true); }; dates.append(all);
    for (const key of keys) {
      const button = node("button", "history-date" + (day === key ? " active" : "")); button.dataset.date = key;
      button.append(node("span", "", dateLabel(key)), node("small", "", String(visits.filter(v => dateKey(v.at) === key).length)));
      button.onclick = () => { day = key; selected = null; refresh(true); }; dates.append(button);
    }
    search.placeholder = day === "all" ? "Search all history" : "Search within this date";
    const query = search.value.trim().toLowerCase();
    const filtered = visits.filter(v => (day === "all" || dateKey(v.at) === day) && `${v.title} ${v.url}`.toLowerCase().includes(query)).sort((a,b) => a.at - b.at);
    // Keep the interactive scene bounded; date and search controls reach older visits.
    visible = filtered.slice(-300);
    if (selected && !visible.some(v => v.id === selected)) selected = null;
    shape = historyLayout(visible, visits); groups = shape.groups;
    title.textContent = day === "all" ? "Navigation journeys" : dateLabel(day);
    root.querySelector(".history-count").textContent = `${visible.length} of ${filtered.length} visits`;
    empty.hidden = visible.length > 0;
    empty.textContent = visits.length ? "No visits match this date and search." : "Your next page begins a trail. Browse normally to build your history.";
    root.querySelector(".history-summary").textContent = filtered.length > 300 ? "Latest 300 shown · choose a date or search to narrow the view" : `${groups.length} ${groups.length === 1 ? "journey" : "journeys"} · arrows follow your navigation`;
    listeners.forEach(callback => callback()); renderSidebar(); showDetails();
    if (refit) fit();
  }
  function resize() {
    if (!renderer || !openState) return;
    const { width, height } = stage.getBoundingClientRect(); if (!width || !height) return;
    renderer.setSize(width, height); labels.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
  }
  function fit() {
    if (!renderer) return; resize(); flight = null;
    const points = [...shape.positions.values()];
    const box = new THREE.Box3().setFromPoints(points.map(p => new THREE.Vector3(p.x, p.y, p.z)));
    const center = points.length ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const size = points.length ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(20, 0, 20);
    const distance = Math.max(45, size.z * 1.5 + 25, (size.x + 35) / Math.max(.3, camera.aspect));
    controls.maxDistance = Math.max(4000, distance * 3);
    camera.far = Math.max(10000, distance * 5); camera.updateProjectionMatrix();
    controls.target.copy(center); camera.position.copy(center).add(new THREE.Vector3(0, distance * .8, distance * .7));
    scene.fog.density = .35 / distance;
    setOrbit(!motion.matches); controls.update();
  }
  function tick(now) {
    if (!openState || !renderer) return; frame = requestAnimationFrame(tick);
    const time = now / 1000, dt = lastTime === null ? 0 : Math.min(.1, time - lastTime); lastTime = time;
    if (flight) {
      const blend = motion.matches ? 1 : 1 - Math.exp(-dt * 5);
      controls.target.lerp(flight.target, blend);
      camera.position.lerp(flight.target.clone().add(flight.offset), blend);
      if (controls.target.distanceTo(flight.target) < .05 && camera.position.distanceTo(flight.target.clone().add(flight.offset)) < .05) flight = null;
    }
    controls.update(dt); backdrop.update(motion.matches ? 0 : time); stars.update(time);
    constellations.update(motion.matches ? 0 : time);
    const ancestors = pathTo(selected);
    for (const item of arrows) {
      const a = stars.positionOf(item.from), b = stars.positionOf(item.to); if (!a || !b) continue;
      const direction = b.clone().sub(a), length = direction.length();
      item.arrow.visible = length > 2;
      if (length > 2) {
        direction.normalize(); item.arrow.position.copy(a).addScaledVector(direction, 1);
        item.arrow.setDirection(direction); item.arrow.setLength(length - 2, .9, .55);
        const highlighted = ancestors.has(item.to);
        item.arrow.setColor(highlighted ? 0xe3f7ff : item.kind === "new-tab" ? 0xb8a2de : 0x82cddd);
        item.arrow.line.material.opacity = selected ? (highlighted ? .95 : .18) : .6;
        item.arrow.cone.material.opacity = selected ? (highlighted ? 1 : .28) : .8;
      }
    }
    renderer.render(scene, camera); labels.render(scene, camera);
  }
  function setOrbit(enabled) {
    if (controls) controls.autoRotate = enabled && !motion.matches;
    const button = root.querySelector(".history-orbit");
    button.textContent = controls?.autoRotate ? "Pause orbit" : "Resume orbit";
    button.setAttribute("aria-pressed", String(Boolean(controls?.autoRotate)));
  }
  root.querySelector(".history-orbit").onclick = () => setOrbit(!controls?.autoRotate);
  motion.addEventListener("change", () => { if (motion.matches) setOrbit(false); if (controls) controls.enableDamping = !motion.matches; });
  const sidebarToggle = root.querySelector(".history-sidebar-toggle");
  function setSidebarHidden(hidden) {
    root.classList.toggle("sidebar-hidden", hidden);
    root.querySelector(".cosmos-sidebar").inert = hidden;
    sidebarToggle.setAttribute("aria-expanded", String(!hidden));
    sidebarToggle.title = hidden ? "Show history list" : "Hide history list";
    sidebarToggle.setAttribute("aria-label", sidebarToggle.title);
    try { localStorage.setItem("orbit.history.sidebarHidden", hidden ? "1" : "0"); } catch { /* storage unavailable */ }
  }
  let sidebarHidden = false;
  try { sidebarHidden = localStorage.getItem("orbit.history.sidebarHidden") === "1"; } catch { /* storage unavailable */ }
  setSidebarHidden(sidebarHidden);
  sidebarToggle.onclick = () => setSidebarHidden(!root.classList.contains("sidebar-hidden"));
  root.querySelector(".history-fit").onclick = fit;
  root.querySelector(".history-close").onclick = close;
  search.oninput = () => refresh(true);
  root.addEventListener("keydown", event => {
    if (event.key === "Escape" && selected) { event.stopPropagation(); selected = null; refresh(false); }
    if (!event.target.matches("input") && event.key.toLowerCase() === "f") { event.preventDefault(); fit(); }
  });
  const confirm = root.querySelector(".history-clear-confirm");
  root.querySelector(".history-clear").onclick = () => { confirm.hidden = false; confirm.querySelector("button").focus(); };
  root.querySelector(".history-cancel").onclick = () => { confirm.hidden = true; };
  root.querySelector(".history-delete").onclick = async () => { await browser.clearHistory(); selected = null; confirm.hidden = true; refresh(true); };
  confirm.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.stopPropagation(); confirm.hidden = true; }
    if (event.key === "Tab") { event.preventDefault(); const buttons = [...confirm.querySelectorAll("button")]; buttons[(buttons.indexOf(document.activeElement) + 1) % buttons.length].focus(); }
  });
  let received = false;
  browser.onHistoryUpdated(payload => { received = true; visits = payload; refresh(false); });
  browser.getHistory().then(payload => { if (!received) visits = payload; refresh(false); });
  new ResizeObserver(resize).observe(stage);
  function open() {
    if (openState) return; openState = true; root.hidden = false; onVisibilityChange(true);
    refresh(true); lastTime = null; if (renderer) frame = requestAnimationFrame(tick); if (!root.classList.contains("sidebar-hidden")) search.focus(); else sidebarToggle.focus();
  }
  function close() {
    if (!openState) return; openState = false; root.hidden = true; cancelAnimationFrame(frame); onVisibilityChange(false);
    document.getElementById("history-tab").focus();
  }
  return { open, close, toggle: () => openState ? close() : open(), isOpen: () => openState };
}
