import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { el, escapeHTML } from "../../lib/dom.js";
import { domainOf } from "../../lib/url.js";
import { createBackdrop } from "./backdrop.js";
import { createBlackHole } from "./black-hole.js";
import { createExplorerFlight } from "./explorer-flight.js";
import { createTabStars } from "./tab-stars.js";
import { createConstellations } from "./constellations.js";

const SPACE_COLOR = 0x050813;
const CLICK_TOLERANCE = 5;
const CAMERA_GLIDE = 4;
const DRAG_START = 6;
// How close to the black hole (in pixels, at least) a dragged star must be
// dropped to close its tab.
const DROP_MIN_PIXELS = 46;

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
  const explorationStatus = el("cosmos-exploration");
  let isOpen = false;
  let explorationPhase = "idle";
  let explorationAutoOpened = false;
  let frame = 0;
  let flight = null;
  let lastTime = null;
  let suppressClick = false;
  let selectionAnchorId = null;
  const hint = el("cosmos-hint");

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (_) {
    stage.insertAdjacentHTML("afterbegin", '<p class="cosmos-unavailable">3D graphics are unavailable on this system.</p>');
  }

  function select(tab, event) {
    // The click that ends a drag isn't a selection.
    if (suppressClick) return;
    if (event && event.shiftKey) {
      stars.toggleSelected(tab.id);
      updateSelectionBar();
    } else if (tabs.isActive(tab)) {
      close();
    } else {
      browser.activateTab(tab.id);
    }
  }

  let scene, camera, controls, labels, backdrop, blackHole, explorer, stars, constellations;
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
    controls.minDistance = 2.5;
    // Scrolling zooms toward whatever is under the pointer, so a cluster
    // can be reached without panning to it first.
    controls.zoomToCursor = true;
    controls.maxDistance = 160;
    controls.autoRotateSpeed = 0.35;
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
      flight = null;
    });

    backdrop = createBackdrop(scene, camera);
    blackHole = createBlackHole(scene);
    explorer = createExplorerFlight(scene, camera, {
      getArrivalStar: () => {
        const tab = tabs.activeTab() || tabs.tabs[0];
        if (!tab || !stars) return null;
        const position = stars.positionOf(tab.id);
        return position ? { id: String(tab.id), position } : null;
      },
      getOrbitTargets: () => tabs.tabs.map(tab => ({ id: String(tab.id), position: stars && stars.positionOf(tab.id) })).filter(target => target.position),
      positionOf: (id) => stars && stars.positionOf(id)
    });
    constellations = createConstellations({
      scene,
      camera,
      tabs,
      positionOf: (id) => stars.positionOf(id),
      onFocus: flyToGroup,
      onRename: (groupId, name) => browser.renameGroup(groupId, name),
      onMerge: (sourceId, targetId) => {
        const source = tabs.groups.find(group => String(group.id) === String(sourceId));
        const target = tabs.groups.find(group => String(group.id) === String(targetId));
        if (!source || !target || String(source.id) === String(target.id)) return;
        const memberIds = tabs.tabs.filter(tab => String(tab.groupId) === String(source.id)).map(tab => tab.id);
        if (memberIds.length) browser.groupTabs(memberIds, { groupId: target.id });
      }
    });
    stars = createTabStars({
      scene,
      camera,
      tabs,
      sink: blackHole,
      isVisible: () => isOpen,
      birthSource: () => new THREE.Vector3(),
      onSelect: select,
      onPress: (star, event) => startPress(star, event),
      onContextMenu: (tab) => browser.showTabMenu(tab.id),
      onLayout: (layout) => constellations.sync(layout)
    });
    bindPointer(renderer.domElement);
    new ResizeObserver(resize).observe(stage);
  }

  // The tab list can be tucked away to give the cosmos the whole width;
  // the choice is remembered on this device.
  const SIDEBAR_KEY = "orbit.cosmos.sidebarHidden";
  const sidebarToggle = el("cosmos-sidebar-toggle");
  function setSidebarHidden(hidden) {
    container.classList.toggle("sidebar-hidden", hidden);
    sidebarToggle.setAttribute("aria-expanded", String(!hidden));
    const label = hidden ? "Show tab list" : "Hide tab list";
    sidebarToggle.title = label;
    sidebarToggle.setAttribute("aria-label", label);
    try { localStorage.setItem(SIDEBAR_KEY, hidden ? "1" : "0"); } catch (_) { /* storage unavailable */ }
  }
  let sidebarHidden = false;
  try { sidebarHidden = localStorage.getItem(SIDEBAR_KEY) === "1"; } catch (_) { /* storage unavailable */ }
  setSidebarHidden(sidebarHidden);
  sidebarToggle.addEventListener("click", () => setSidebarHidden(!container.classList.contains("sidebar-hidden")));

  const stayToggle = el("cosmos-stay-toggle");
  const STAY_ON_NEW_TAB_KEY = "orbit.cosmos.stayOnNewTab";
  let stayOnNewTab = false;
  try { stayOnNewTab = localStorage.getItem(STAY_ON_NEW_TAB_KEY) === "1"; } catch (_) { /* storage unavailable */ }
  function setStayOnNewTab(enabled) {
    stayOnNewTab = Boolean(enabled);
    if (stayToggle) {
      stayToggle.setAttribute("aria-checked", String(stayOnNewTab));
      stayToggle.classList.toggle("active", stayOnNewTab);
      stayToggle.title = stayOnNewTab
        ? "New tabs opened with + keep Orbit visible"
        : "New tabs opened with + switch to the web page";
    }
    try { localStorage.setItem(STAY_ON_NEW_TAB_KEY, stayOnNewTab ? "1" : "0"); } catch (_) { /* storage unavailable */ }
  }
  setStayOnNewTab(stayOnNewTab);
  stayToggle?.addEventListener("click", () => setStayOnNewTab(!stayOnNewTab));

  el("cosmos-reset").addEventListener("click", () => {
    if (renderer) flyHome();
  });

  let previousTabIds = null;
  let previousGroupByTab = null;
  tabs.subscribe(() => {
    const groupByTab = new Map(tabs.tabs.map(tab => [String(tab.id), String(tab.groupId || "")]));
    const tabIds = new Set(groupByTab.keys());
    const tabAdded = previousTabIds !== null && Array.from(tabIds).some(id => !previousTabIds.has(id));
    const groupFormed = previousGroupByTab !== null && Array.from(groupByTab).some(([id, groupId]) =>
      groupId && previousGroupByTab.has(id) && previousGroupByTab.get(id) !== groupId
    );
    previousTabIds = tabIds;
    previousGroupByTab = groupByTab;
    renderTabList();
    if (stars) updateSelectionBar();
    if (isOpen && (tabAdded || groupFormed)) flyHome();
  });

  function renderTabList() {
    const grouped = new Map(tabs.groups.map((group) => [String(group.id), []]));
    const loose = [];
    for (const tab of tabs.tabs) {
      const group = tabs.groupOf(tab);
      if (group && grouped.has(String(group.id))) grouped.get(String(group.id)).push(tab);
      else loose.push(tab);
    }

    // Two parts: every constellation with its tabs, then the tabs in none.
    const sections = [];
    const constellationSections = [];
    for (const group of tabs.groups) {
      const members = grouped.get(String(group.id)) || [];
      if (members.length) constellationSections.push(renderSection(group.name, group.color, members, group.id));
    }
    if (constellationSections.length) sections.push(renderCategory("Constellations", constellationSections.length, constellationSections));
    if (loose.length) sections.push(renderCategory("All Tabs", loose.length, [renderSection(null, "#7786a8", loose)]));
    if (!sections.length) {
      const empty = document.createElement("div");
      empty.className = "cosmos-list-empty";
      empty.innerHTML = '<span class="cosmos-empty-orbit">✦</span><span>No tabs in orbit yet</span><small>Open a page to add its star to the atlas.</small>';
      sections.push(empty);
    }
    tabList.replaceChildren(...sections);
    if (stars) updateSelectionBar();
  }

  function renderCategory(title, count, children) {
    const category = document.createElement("div");
    category.className = "cosmos-list-category";
    const heading = document.createElement("h3");
    heading.className = "cosmos-category-title";
    heading.innerHTML = escapeHTML(title) + "<span>" + count + "</span>";
    category.append(heading, ...children);
    return category;
  }

  // name is null for a plain list of tabs with no group heading.
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
    if (name !== null) section.appendChild(heading);

    for (const tab of members) {
      const item = document.createElement("button");
      const domain = domainOf(tab.url);
      const mark = tab.favicon
        ? '<img src="' + escapeHTML(tab.favicon) + '" alt="">'
        : escapeHTML(domain.slice(0, 1).toUpperCase() || "✦");
      item.type = "button";
      item.className = "cosmos-info-tab" + (tabs.isActive(tab) ? " active" : "");
      item.dataset.tabId = String(tab.id);
      item.setAttribute("aria-pressed", String(stars?.selectedIds().includes(String(tab.id)) || false));
      item.title = (tab.title || "New tab") + "\n" + (tab.url || "No address");
      item.innerHTML = '<span class="cosmos-info-favicon">' + mark + '</span><span class="cosmos-info-copy"><span class="cosmos-info-title">' + escapeHTML(tab.title || "New tab") + '</span><span class="cosmos-info-url">' + escapeHTML(tab.url || domain || "New tab") + '</span></span><span class="cosmos-info-active"></span>';
      item.addEventListener("click", (event) => selectSidebarTab(tab, event));
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
    if (ids.length < 2) return;
    const groupId = await browser.groupTabs(ids);
    stars.clearSelection();
    selectionAnchorId = null;
    updateSelectionBar();
    if (groupId) constellations.editName(groupId);
  });
  el("cosmos-close-selected").addEventListener("click", async () => {
    const ids = stars.selectedIds();
    if (!ids.length) return;
    stars.clearSelection();
    selectionAnchorId = null;
    updateSelectionBar();
    await Promise.all(ids.map((id) => browser.closeTab(id)));
  });
  el("cosmos-clear-selection").addEventListener("click", () => {
    stars.clearSelection();
    selectionAnchorId = null;
    updateSelectionBar();
  });

  function selectSidebarTab(tab, event) {
    const id = String(tab.id);
    const additive = event.ctrlKey || event.metaKey;
    if (event.shiftKey) {
      const rows = Array.from(tabList.querySelectorAll(".cosmos-info-tab[data-tab-id]"));
      const targetIndex = rows.findIndex((row) => row.dataset.tabId === id);
      const anchorIndex = rows.findIndex((row) => row.dataset.tabId === selectionAnchorId);
      if (targetIndex >= 0 && anchorIndex >= 0) {
        const selected = new Set(additive ? stars.selectedIds() : []);
        rows.slice(Math.min(targetIndex, anchorIndex), Math.max(targetIndex, anchorIndex) + 1)
          .forEach((row) => selected.add(row.dataset.tabId));
        stars.clearSelection();
        for (const selectedId of selected) stars.toggleSelected(selectedId);
      } else {
        if (!stars.selectedIds().includes(id)) stars.toggleSelected(id);
        selectionAnchorId = id;
      }
      updateSelectionBar();
      return;
    }
    if (additive) {
      stars.toggleSelected(id);
      selectionAnchorId = id;
      updateSelectionBar();
      return;
    }
    stars.clearSelection();
    selectionAnchorId = id;
    updateSelectionBar();
    select(tab, event);
  }

  function updateSelectionBar() {
    const selectedIds = stars ? stars.selectedIds() : [];
    const selected = new Set(selectedIds);
    if (selectionAnchorId && !tabs.tabs.some((tab) => String(tab.id) === selectionAnchorId)) selectionAnchorId = null;
    for (const row of tabList.querySelectorAll(".cosmos-info-tab[data-tab-id]")) {
      const isSelected = selected.has(row.dataset.tabId);
      row.classList.toggle("selected", isSelected);
      row.setAttribute("aria-pressed", String(isSelected));
    }
    const count = selectedIds.length;
    selectionBar.hidden = count === 0;
    el("cosmos-selection-count").textContent = count + (count === 1 ? " tab selected" : " tabs selected");
    el("cosmos-group").disabled = count < 2;
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
      if (down || press) return;
      const star = starAt(event);
      stars.setHovered(star);
      canvas.style.cursor = star ? "grab" : "";
    });
    // Capture phase, so it runs before the camera controls see the press
    // and a star under the pointer can be dragged instead of the view.
    canvas.addEventListener("pointerdown", (event) => {
      const star = starAt(event);
      if (star) startPress(star, event);
    }, { capture: true });
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

  // Dragging a star: it moves in the plane facing the camera through where
  // it was picked up. Dropping it on the black hole closes its tab, and it
  // falls in from there; dropping it anywhere else sends it home.
  const dragRay = new THREE.Raycaster();
  const dragPointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const dragHit = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  let press = null;

  function rayFrom(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    dragPointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    dragRay.setFromCamera(dragPointer, camera);
    return dragRay.ray;
  }

  function toScreen(point) {
    const rect = renderer.domElement.getBoundingClientRect();
    scratch.copy(point).project(camera);
    return { x: rect.left + (scratch.x + 1) / 2 * rect.width, y: rect.top + (1 - scratch.y) / 2 * rect.height, behind: scratch.z > 1 };
  }

  function overBlackHole(event) {
    const center = toScreen(new THREE.Vector3());
    if (center.behind) return false;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(blackHole.diskRadius);
    const edge = toScreen(right);
    const reach = Math.max(DROP_MIN_PIXELS, Math.hypot(edge.x - center.x, edge.y - center.y) * 1.3);
    return Math.hypot(event.clientX - center.x, event.clientY - center.y) < reach;
  }

  // The constellation (other than the star's own) whose region the pointer
  // is over, nearest first.
  function constellationUnder(event, star) {
    const own = star.tab.groupId ? String(star.tab.groupId) : null;
    let best = null;
    for (const groupId of constellations.ids()) {
      if (String(groupId) === own) continue;
      const center3 = constellations.centerOf(groupId);
      const center = toScreen(center3);
      if (center.behind) continue;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(constellations.radiusOf(groupId) + 1.5);
      const edge = toScreen(center3.add(right));
      const reach = Math.max(40, Math.hypot(edge.x - center.x, edge.y - center.y));
      const distance = Math.hypot(event.clientX - center.x, event.clientY - center.y);
      if (distance < reach && (!best || distance < best.distance)) best = { groupId, distance };
    }
    return best ? best.groupId : null;
  }

  function showHint(text, doom) {
    hint.hidden = !text;
    hint.textContent = text || "";
    hint.classList.toggle("doom", Boolean(doom));
  }

  function startPress(star, event) {
    if (!renderer || event.button !== 0 || event.shiftKey || press) return;
    press = { star, x: event.clientX, y: event.clientY, dragging: false, over: false, join: null, joinTarget: null, offset: new THREE.Vector3() };
    controls.enabled = false;
    window.addEventListener("pointermove", movePress);
    window.addEventListener("pointerup", endPress);
    window.addEventListener("pointercancel", endPress);
  }

  function movePress(event) {
    if (!press) return;
    const { star } = press;
    if (!press.dragging) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_START) return;
      press.dragging = true;
      flight = null;
      controls.autoRotate = false;
      stars.grab(star);
      container.classList.add("dragging-star");
      dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(scratch).clone(), star.root.position);
      if (rayFrom(event).intersectPlane(dragPlane, dragHit)) press.offset.copy(star.root.position).sub(dragHit);
    }
    const over = overBlackHole(event);
    if (rayFrom(event).intersectPlane(dragPlane, dragHit)) {
      star.root.position.copy(dragHit).add(press.offset);
      // Over the hole, the star is tugged part of the way in.
      if (over) star.root.position.multiplyScalar(0.65);
    }
    if (over !== press.over) {
      press.over = over;
      stars.setDoomed(star, over);
      blackHole.lure(over);
    }
    // The black hole wins; otherwise a star under the pointer takes priority
    // over its constellation so a drop can create or join a group directly.
    rayFrom(event);
    const joinTarget = over ? null : stars.pick(dragRay, star.id);
    const targetGroup = joinTarget && joinTarget.tab.groupId
      ? tabs.groups.find((item) => String(item.id) === String(joinTarget.tab.groupId))
      : null;
    const join = over ? null : targetGroup ? targetGroup.id : joinTarget ? null : constellationUnder(event, star);
    const group = targetGroup || (join ? tabs.groups.find((item) => String(item.id) === String(join)) : null);
    const previousTarget = press.joinTarget;
    if (joinTarget !== press.joinTarget) {
      if (press.joinTarget) stars.setDropTarget(press.joinTarget, false);
      press.joinTarget = joinTarget;
      if (joinTarget) stars.setDropTarget(joinTarget, true);
    }
    if (join !== press.join || joinTarget !== previousTarget) {
      press.join = join;
      constellations.setHighlighted(join);
      const targetColor = group?.color || (joinTarget ? joinTarget.element.style.getPropertyValue("--star-color") : null);
      stars.setJoining(star, targetColor || null);
    }
    const title = "“" + (star.tab.title || "this tab") + "”";
    const targetTitle = joinTarget && (joinTarget.tab.title || "this tab");
    if (over) showHint("Release to close " + title, true);
    else if (joinTarget && String(joinTarget.tab.groupId || "") === String(star.tab.groupId || "") && star.tab.groupId) {
      showHint("“" + (star.tab.title || "This tab") + "” and “" + targetTitle + "” are already in the same constellation");
    } else if (joinTarget && targetGroup) showHint("Release to add " + title + " to " + targetGroup.name);
    else if (joinTarget) showHint("Release to create a constellation with " + title + " and “" + targetTitle + "”");
    else if (group) showHint("Release to add " + title + " to " + group.name);
    else showHint("Drop on a star or constellation to group it · on the black hole to close it");
  }

  function endPress() {
    window.removeEventListener("pointermove", movePress);
    window.removeEventListener("pointerup", endPress);
    window.removeEventListener("pointercancel", endPress);
    if (!press) return;
    const { star, dragging, over, join, joinTarget } = press;
    press = null;
    controls.enabled = true;
    if (!dragging) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    container.classList.remove("dragging-star");
    showHint(null);
    blackHole.lure(false);
    constellations.setHighlighted(null);
    if (joinTarget) stars.setDropTarget(joinTarget, false);
    stars.setJoining(star, null);
    stars.release(star, { stay: over });
    if (over) browser.closeTab(star.tab.id);
    else if (joinTarget) {
      if (star.tab.groupId && String(star.tab.groupId) === String(joinTarget.tab.groupId)) return;
      if (joinTarget.tab.groupId) browser.groupTabs([star.tab.id], { groupId: joinTarget.tab.groupId });
      else browser.groupTabs([star.tab.id, joinTarget.tab.id]).then((groupId) => {
        if (groupId) constellations.editName(groupId);
      });
    } else if (join) browser.groupTabs([star.tab.id], { groupId: join });
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
    const distance = Math.max(18, stars.extent() * 2.1);
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
    const distance = Math.max(10, constellations.radiusOf(groupId) * 3 + 5);
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
    blackHole.update(time);
    stars.update(time);
    constellations.update(time);
    const explorationFinished = explorer ? explorer.update(time, delta) : false;
    renderer.render(scene, camera);
    labels.render(scene, camera);
    if (explorationPhase === "exiting" && explorationFinished) finishExploration();
  }

  function showExplorationStatus(kicker, title) {
    explorationStatus.querySelector(".cosmos-exploration-kicker").textContent = kicker;
    explorationStatus.querySelector(".cosmos-exploration-title").textContent = title;
    explorationStatus.hidden = false;
  }

  function clearExploration() {
    explorationPhase = "idle";
    explorationAutoOpened = false;
    if (explorer) explorer.cancel();
    container.classList.remove("exploring", "exploration-exiting");
    explorationStatus.hidden = true;
  }

  function finishExploration() {
    const closeAfter = explorationAutoOpened;
    clearExploration();
    if (closeAfter && isOpen) close();
  }

  function setExploring(busy) {
    if (busy) {
      if (explorationPhase === "active") return;
      if (explorationPhase === "idle") explorationAutoOpened = !isOpen;
      if (!isOpen) open();
      explorationPhase = "active";
      container.classList.add("exploring");
      container.classList.remove("exploration-exiting");
      showExplorationStatus("ORBIT AI · EXPLORING", "Charting a course through space…");
      if (explorer) explorer.start();
      return;
    }
    if (explorationPhase !== "active") return;
    explorationPhase = "exiting";
    container.classList.add("exploration-exiting");
    showExplorationStatus("RESPONSE READY · RETURNING", "Bringing the explorer home…");
    if (explorer) explorer.finish();
    else finishExploration();
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
    if (explorationPhase !== "idle") clearExploration();
    isOpen = false;
    cancelAnimationFrame(frame);
    if (press) endPress();
    flight = null;
    container.hidden = true;
    if (stars) {
      stars.setHovered(null);
      stars.clearSelection();
      stars.finishBirths();
      stars.finishFalling();
      updateSelectionBar();
    }
    onVisibilityChange(false);
  }

  return {
    open,
    close,
    setExploring,
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
    },
    stayOnNewTab: () => stayOnNewTab
  };
}
