import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { createConstellations } from "../cosmos/constellations.js";
import { createBackdrop } from "../cosmos/backdrop.js";
import { createTabStars } from "../cosmos/tab-stars.js";
import { dateKey, dateLabel, clock, historyLayout, navigationRoutes } from "./history-layout.mjs";

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
  const listView = root.querySelector(".history-list-view");
  const entries = root.querySelector(".history-entry-list");
  const clearSearch = root.querySelector(".history-search-clear");
  let entryLimit = 100;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let visits = [], selected = null, day = "all", visible = [], groups = [];
  let shape = historyLayout([]), focusIds = null, focusGroupId = null, detailsDismissed = false;
  let openState = false, frame = 0, renderer, camera, controls, labels, stars, backdrop;
  let constellations, arrows = [], dateObjects = [], flight = null, lastTime = null;
  const listeners = new Set();
  const store = {
    get tabs() { return visible.map(v => ({ ...v, groupId: shape?.groupOf.get(v.id) })); },
    get groups() { return groups; },
    groupOf: tab => groups.find(g => g.id === tab.groupId),
    isActive: tab => tab.id === selected,
    subscribe(callback) { listeners.add(callback); callback(); return () => listeners.delete(callback); }
  };
  let scene;
  function initializeScene() {
    if (scene) return;
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x050813);
  scene.fog = new THREE.FogExp2(0x050813, .004);
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
  catch { root.classList.add("history-no-webgl"); }
  if (renderer) {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.domElement.className = "cosmos-canvas";
    labels = new CSS2DRenderer(); labels.domElement.className = "cosmos-labels";
    stage.prepend(renderer.domElement, labels.domElement);
    camera = new THREE.PerspectiveCamera(55, 1, .1, 10000);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = false; controls.autoRotateSpeed = .35;
    controls.enableDamping = !motion.matches; controls.dampingFactor = .08;
    controls.minAzimuthAngle = -.7; controls.maxAzimuthAngle = .7;
    controls.minPolarAngle = .85; controls.maxPolarAngle = 2.25;
    controls.zoomToCursor = true; controls.minDistance = 2.5; controls.maxDistance = 4000;
    controls.addEventListener("start", () => { flight = null; setOrbit(false); });
    labels.domElement.addEventListener("wheel", event => {
      event.preventDefault(); renderer.domElement.dispatchEvent(new WheelEvent("wheel", event));
    }, { passive: false });
    backdrop = createBackdrop(scene, camera);
    constellations = createConstellations({ scene, camera, tabs: store,
      positionOf: id => stars?.positionOf(id), onFocus: focusGroup,
      emphasisFor: group => focusIds === null || group.memberIds.some(id => focusIds.has(id)) ? 1 : .3 });
    stars = createTabStars({ scene, camera, tabs: store,
      onSelect: visit => select(visit.id), onContextMenu: visit => select(visit.id),
      reducedMotion: () => motion.matches, animateLayout: false,
      emphasisFor: visit => focusIds === null || focusIds.has(visit.id) ? 1 : .28,
      layout: { compute() {
        const positions = new Map([...shape.positions].map(([id, p]) => [id, new THREE.Vector3(p.x, p.y, p.z)]));
        const clusters = new Map(groups.map(g => [g.id, { ...g, edges: [], center: new THREE.Vector3(g.center.x, g.center.y, g.center.z) }]));
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
    renderer.domElement.addEventListener("dblclick", e => { const star = hit(e); if (star) openVisit(star.id); else overview(); });
  }
  }
  function drawTrails() {
    for (const item of arrows) {
      scene.remove(item.line, item.arrow); item.line.geometry.dispose(); item.line.material.dispose(); item.arrow.dispose();
    }
    arrows = [];
    for (const item of dateObjects) {
      item.label.removeFromParent(); item.label.element.remove(); scene.remove(item.line);
      item.line.geometry.dispose(); item.line.material.dispose();
    }
    dateObjects = [];
    for (const route of navigationRoutes(visible, shape.positions).values()) {
      const points = route.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ transparent: true, opacity: .65, depthWrite: false }));
      const b = points.at(-1), direction = b.clone().sub(points.at(-2)).normalize();
      const arrow = new THREE.ArrowHelper(direction, b.clone().addScaledVector(direction, -2.4), .8, 0x82cddd, .65, .45);
      arrow.line.material.visible = false; arrow.cone.material.transparent = true;
      scene.add(line, arrow); arrows.push({ line, arrow, ...route });
    }
    const ys = [...shape.positions.values()].map(p => p.y);
    const bottom = ys.length ? Math.min(...ys) - 10 : -10;
    for (const date of shape.days) {
      const element = node("div", "history-date-label" + ((focusIds === null || visible.some(v => focusIds.has(v.id) && dateKey(v.at) === date.id)) ? " in-focus" : ""));
      element.dataset.date = date.id;
      const button = node("button", "", date.name); button.onclick = () => focusDate(date.id);
      element.append(button, node("small", "", `${visible.filter(v => dateKey(v.at) === date.id).length} visits`));
      const label = new CSS2DObject(element); label.position.set((date.start + date.end) / 2, date.y, 0);
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(date.start - 5, bottom, -.2), new THREE.Vector3(date.start - 5, date.y - 7, -.2)]);
      const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: 0x6085a5, transparent: true, opacity: .15, dashSize: 1.2, gapSize: 1.8, depthWrite: false }));
      line.computeLineDistances(); scene.add(label, line); dateObjects.push({ label, line });
    }
  }
  function focusDate(key) {
    day = key; selected = null; detailsDismissed = false; refresh(true);
    sidebar.querySelector(`[data-visit-id="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }
  function showList() {
    day = "all"; selected = null; detailsDismissed = false; search.value = ""; entryLimit = 100; refresh(true); search.focus();
  }
  function overview() { day = "all"; selected = null; detailsDismissed = false; refresh(true); }
  function focusGroup(id) {
    const group = groups.find(g => g.id === id); if (!group) return;
    day = "group"; focusGroupId = id; selected = group.memberIds.at(-1); detailsDismissed = false; refresh(false);
    if (renderer) {
      const view = viewFor(group.memberIds.map(id => shape.positions.get(id)));
      flight = view; setOrbit(false);
    }
  }
  function pathTo(id) {
    const ancestors = new Set(); const byId = new Map(visits.map(v => [v.id, v]));
    while (id && !ancestors.has(id)) { ancestors.add(id); id = byId.get(id)?.parent; }
    return ancestors;
  }
  function select(id, focus = false) {
    selected = id; day = "visit"; focusGroupId = shape.groupOf.get(id); detailsDismissed = false; refresh(false);
    if (focus && renderer) {
      const p = shape.positions.get(id); if (p) {
        const distance = Math.min(50, camera.position.distanceTo(controls.target));
        flight = { target: new THREE.Vector3(p.x, p.y, p.z), offset: new THREE.Vector3(0, 0, distance) }; setOrbit(false);
      }
    }
  }
  async function openVisit(id) { if (await browser.openHistory(id)) close(); }
  function showDetails() {
    details.replaceChildren(); const visit = visits.find(v => v.id === selected);
    details.hidden = !visit || detailsDismissed; if (!visit || detailsDismissed) return;
    const top = node("div", "history-detail-heading");
    top.append(node("span", "cosmos-title", "VISIT DETAILS"));
    const dismiss = node("button", "history-quiet", "×"); dismiss.setAttribute("aria-label", "Close visit details");
    dismiss.onclick = () => { selected = null; detailsDismissed = true; refresh(false); }; top.append(dismiss);
    details.append(top, node("h2", "", visit.title || host(visit.url)), node("p", "history-detail-url", visit.url), node("p", "history-detail-time", `${dateLabel(dateKey(visit.at))} · ${clock(visit.at)}`));
    const open = node("button", "history-open", visit.liveTabId ? "Return to open tab ↗" : "Reopen this page ↗"); open.onclick = () => openVisit(visit.id); details.append(open);
    const linked = [visits.find(v => v.id === visit.parent), ...visits.filter(v => v.parent === visit.id)].filter(Boolean);
    if (linked.length) details.append(node("h3", "cosmos-title", "CONNECTED VISITS"));
    for (const v of linked.slice(0, 8)) {
      const relation = v.id === visit.parent ? "From" : v.kind === "new-tab" ? "New tab" : "To";
      const button = node("button", "history-related", `${relation} · ${clock(v.at)} · ${v.title || host(v.url)}`);
      button.onclick = () => { search.value = ""; entryLimit = Math.max(100, visits.length); selected = null; day = "all"; refresh(false); entries.querySelector(`[data-visit-id="${v.id}"]`)?.scrollIntoView({ block: "center" }); }; details.append(button);
    }
    details.append(node("p", "history-note", "Saved visit information. Reopening loads the current version of the page."));
  }
  function renderSidebar() {
    const focused = document.activeElement?.dataset.visitId;
    sidebar.replaceChildren();
    for (const group of [...groups].sort((a, b) => b.lastAt - a.lastAt)) {
      const section = node("section", "cosmos-list-group");
      section.style.setProperty("--group-color", group.color);
      const heading = node("button", "cosmos-group-heading");
      heading.append(node("span", "cosmos-group-dot"), node("span", "cosmos-group-name", group.name), node("span", "cosmos-group-count", String(group.memberIds.length)));
      heading.title = `${group.name} · Focus navigation journey`;
      heading.onclick = () => focusGroup(group.id); section.append(heading);
      const ids = new Set(group.memberIds);
      for (const visit of visible.filter(v => ids.has(v.id)).sort((a, b) => b.at - a.at)) {
        const button = node("button", "cosmos-info-tab" + (visit.id === selected ? " active" : "")); button.dataset.visitId = visit.id;
        button.classList.toggle("history-context-row", focusIds !== null && !focusIds.has(visit.id));
        button.title = `${visit.title}\n${visit.url}\n${new Date(visit.at).toLocaleString()}`;
        const time = node("span", "history-visit-clock");
        time.append(node("small", "", new Date(visit.at).toLocaleDateString([], { month: "short", day: "numeric" })));
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
  function renderEntries() {
    const ordered = [...visits].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
    entries.replaceChildren();
    const sections = new Map();
    for (const visit of ordered.slice(0, entryLimit)) {
      const key = dateKey(visit.at);
      if (!sections.has(key)) {
        const section = node("section", "history-entry-day");
        section.dataset.date = key; section.append(node("h2", "", dateLabel(key)));
        entries.append(section); sections.set(key, section);
      }
      const link = node("a", "history-entry"); link.href = visit.url; link.dataset.visitId = visit.id;
      link.title = `${visit.title || host(visit.url)}\n${visit.url}\n${new Date(visit.at).toLocaleString()}`;
      const time = node("time", "history-entry-time", clock(visit.at)); time.dateTime = new Date(visit.at).toISOString();
      const icon = node("span", "history-entry-icon");
      if (visit.favicon) { const image = document.createElement("img"); image.src = visit.favicon; image.alt = ""; icon.append(image); }
      else icon.textContent = host(visit.url).slice(0, 1).toUpperCase();
      const copy = node("span", "history-entry-copy");
      copy.append(node("span", "history-entry-title", visit.title || host(visit.url)), node("span", "history-entry-url", visit.url));
      link.append(time, icon, copy);
      if (visit.liveTabId) link.append(node("span", "history-entry-live", "Open tab"));
      link.append(node("span", "history-entry-arrow", "↗"));
      link.onclick = event => { event.preventDefault(); void openVisit(visit.id); };
      sections.get(key).append(link);
    }
    root.querySelector(".history-list-count").textContent = `${Math.min(entryLimit, visits.length)} of ${visits.length} visits`;
    root.querySelector(".history-list-empty").hidden = visits.length > 0;
    root.querySelector(".history-load-more").hidden = entryLimit >= visits.length;
  }
  function setView(searching) {
    const previous = root.dataset.view;
    root.dataset.view = searching ? "stars" : "list";
    stage.hidden = !searching; root.querySelector(".cosmos-sidebar").hidden = !searching; listView.hidden = searching;
    clearSearch.hidden = !search.value;
    root.querySelector(".history-view-caption").textContent = searching ? "Search results, connected" : "Your recent browsing";
    if (searching) {
      initializeScene();
      if (renderer && !frame) { lastTime = null; frame = requestAnimationFrame(tick); }
    } else {
      cancelAnimationFrame(frame); frame = 0; lastTime = null;
      if (previous === "stars") listView.scrollTop = 0;
    }
  }
  function refresh(refit = false) {
    if (!openState) return;
    const query = search.value.trim().toLowerCase();
    if (!query) {
      setView(false); visible = []; groups = []; shape = historyLayout([]); focusIds = null; selected = null;
      root.dataset.focusMode = "list"; root.dataset.focusVisit = "";
      listeners.forEach(callback => callback()); sidebar.replaceChildren(); dates.replaceChildren(); details.hidden = true;
      renderEntries(); return;
    }
    const keys = [...new Set(visits.map(v => dateKey(v.at)))].sort().reverse();
    dates.replaceChildren();
    const recent = node("button", "history-date", "← Back to history"); recent.onclick = showList; dates.append(recent);
    const all = node("button", "history-date" + (day === "all" ? " active" : ""), "All dates"); all.onclick = overview; dates.append(all);
    for (const key of keys) {
      const button = node("button", "history-date" + (day === key ? " active" : "")); button.dataset.date = key;
      button.append(node("span", "", dateLabel(key)), node("small", "", String(visits.filter(v => dateKey(v.at) === key).length)));
      button.onclick = () => focusDate(key); dates.append(button);
    }
    search.placeholder = "Search all history";
    const filtered = visits.filter(v => `${v.title} ${v.url}`.toLowerCase().includes(query)).sort((a,b) => a.at - b.at || a.id.localeCompare(b.id));
    // Keep recent context when focusing an older retained date; cap expensive star labels.
    let priority = keys.includes(day) ? filtered.filter(v => dateKey(v.at) === day).slice(-200) : [];
    const chosen = visits.find(v => v.id === selected);
    if ((day === "visit" || day === "group") && chosen) {
      const full = historyLayout(filtered, visits);
      const groupId = full.groupOf.get(chosen.id);
      priority = filtered.filter(v => full.groupOf.get(v.id) === groupId).slice(-200);
    }
    const sceneVisits = new Map([...filtered.slice(-Math.max(0, 300 - priority.length)), ...priority].map(v => [v.id, v]));
    if (chosen && filtered.some(v => v.id === chosen.id) && !sceneVisits.has(chosen.id)) {
      sceneVisits.delete(sceneVisits.keys().next().value); sceneVisits.set(chosen.id, chosen);
    }
    visible = [...sceneVisits.values()].sort((a,b) => a.at - b.at || a.id.localeCompare(b.id));
    if (selected && !visible.some(v => v.id === selected)) selected = null;
    shape = historyLayout(visible, visits); groups = shape.groups;
    const focusedDay = keys.includes(day) ? day : null;
    if (focusedDay && !detailsDismissed) selected = [...visible].reverse().find(v => dateKey(v.at) === focusedDay)?.id || null;
    if (day === "visit" && selected) focusGroupId = shape.groupOf.get(selected);
    focusIds = day === "all" ? null : new Set(visible.filter(v => focusedDay ? dateKey(v.at) === focusedDay : shape.groupOf.get(v.id) === focusGroupId).map(v => v.id));
    root.dataset.focusMode = day === "all" || day === "visit" || day === "group" ? day : "date";
    root.dataset.focusVisit = selected || "";
    title.textContent = focusedDay ? dateLabel(focusedDay) : "Search constellations";
    root.querySelector(".history-count").textContent = `${visible.length} of ${filtered.length} visits`;
    empty.hidden = visible.length > 0;
    empty.textContent = visits.length ? "No pages match your search. Try a title or website address." : "Your browsing history will appear here.";
    root.querySelector(".history-summary").textContent = filtered.length > 300 ? "300 visits shown · focus a date to reach older history" : "Older ← · Time flows left to right · → Newer";
    setView(true);
    listeners.forEach(callback => callback()); renderSidebar(); showDetails();
    if (refit) fit();
  }
  function resize() {
    if (!renderer || !openState || root.dataset.view !== "stars") return;
    const { width, height } = stage.getBoundingClientRect(); if (!width || !height) return;
    renderer.setSize(width, height); labels.setSize(width, height); camera.aspect = width / height;
    const sidebarWidth = root.classList.contains("sidebar-hidden") ? 0 : root.querySelector(".cosmos-sidebar").getBoundingClientRect().width;
    camera.setViewOffset(width, height, -sidebarWidth / 2, 0, width, height); camera.updateProjectionMatrix();
  }
  function viewFor(points) {
    const vectors = points.filter(Boolean).map(p => new THREE.Vector3(p.x, p.y, p.z));
    const box = new THREE.Box3().setFromPoints(vectors);
    const target = vectors.length ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const size = vectors.length ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(20, 20, 0);
    const { width, height } = stage.getBoundingClientRect();
    const sidebarWidth = root.classList.contains("sidebar-hidden") ? 0 : root.querySelector(".cosmos-sidebar").getBoundingClientRect().width;
    const aspect = Math.max(.3, (width - sidebarWidth) / Math.max(1, height));
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = Math.max(42, (size.y + 36) / (2 * tangent), (size.x + 36) / (2 * tangent * aspect));
    return { target, offset: new THREE.Vector3(0, 0, distance) };
  }
  function fit() {
    if (!renderer) return; resize(); flight = null;
    const points = [...shape.positions.values(), ...shape.days.map(d => ({ x: (d.start + d.end) / 2, y: d.y, z: 0 }))];
    const { target, offset } = viewFor(points);
    controls.maxDistance = Math.max(4000, offset.z * 3);
    camera.far = Math.max(10000, offset.z * 5); camera.updateProjectionMatrix();
    controls.target.copy(target); camera.position.copy(target).add(offset);
    scene.fog.density = .12 / offset.z;
    setOrbit(false); controls.update();
  }
  function tick(now) {
    if (!openState || !renderer || root.dataset.view !== "stars") { frame = 0; return; } frame = requestAnimationFrame(tick);
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
      const highlighted = ancestors.has(item.to) && ancestors.has(item.from);
      const context = focusIds !== null && !focusIds.has(item.from) && !focusIds.has(item.to);
      const color = highlighted ? 0xe3f7ff : item.kind === "new-tab" ? 0xb8a2de : 0x82cddd;
      item.line.material.color.setHex(color); item.arrow.setColor(color);
      item.line.material.opacity = highlighted ? .95 : context ? .16 : .62;
      item.arrow.cone.material.opacity = highlighted ? 1 : context ? .24 : .8;
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
  sidebarToggle.onclick = () => { setSidebarHidden(!root.classList.contains("sidebar-hidden")); fit(); };
  root.querySelector(".history-fit").onclick = overview;
  clearSearch.onclick = showList;
  root.querySelector(".history-load-more").onclick = () => { entryLimit += 100; renderEntries(); };
  root.querySelector(".history-close").onclick = close;
  search.oninput = () => { day = "all"; selected = null; focusGroupId = null; detailsDismissed = false; refresh(true); };
  root.addEventListener("keydown", event => {
    if (event.key === "Escape" && event.target === search && search.value) {
      event.preventDefault(); event.stopPropagation(); showList(); return;
    }
    if (event.key === "Escape" && selected) { event.stopPropagation(); selected = null; day = "all"; detailsDismissed = false; refresh(false); }
    if (root.dataset.view === "stars" && !event.target.matches("input") && event.key.toLowerCase() === "f") { event.preventDefault(); overview(); }
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
    day = "all"; selected = null; detailsDismissed = false; search.value = ""; entryLimit = 100;
    refresh(true); listView.scrollTop = 0; sidebar.scrollTop = 0; search.focus();
  }
  function close() {
    if (!openState) return; openState = false; root.hidden = true; cancelAnimationFrame(frame); frame = 0; onVisibilityChange(false);
    document.getElementById("history-tab").focus();
  }
  return { open, close, toggle: () => openState ? close() : open(), isOpen: () => openState };
}
