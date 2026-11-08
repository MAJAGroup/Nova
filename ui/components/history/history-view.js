import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { createConstellations } from "../cosmos/constellations.js";
import { createBackdrop } from "../cosmos/backdrop.js";
import { createBlackHole } from "../cosmos/black-hole.js";
import { createExplorerFlight } from "../cosmos/explorer-flight.js";
import { createTabStars } from "../cosmos/tab-stars.js";
import { dateKey, dateLabel, clock, historyLayout } from "./history-layout.mjs";

function node(tag, className, text) {
  const element = document.createElement(tag); element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
const host = url => { try { return new URL(url).hostname; } catch { return url; } };
const TIMELINE_WINDOW_SIZE = 30;
const TIMELINE_WINDOW_CENTER = Math.floor((TIMELINE_WINDOW_SIZE - 1) / 2);
const TIMELINE_WINDOW_END = TIMELINE_WINDOW_SIZE - 1;

function clearBlackHoleLane(layout) {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const ordered = [...layout.groups].sort((a, b) => Math.hypot(a.center.x, a.center.z) - Math.hypot(b.center.x, b.center.z));
  const placed = [];
  for (const group of ordered) {
    const minimumDistance = group.radius + 5.5;
    if (Math.hypot(group.center.x, group.center.z) >= minimumDistance) { placed.push(group); continue; }
    let hash = 2166136261;
    for (const character of String(group.id)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    const baseAngle = (hash >>> 0) / 4294967296 * Math.PI * 2;
    let next = null;
    for (let attempt = 0; attempt < 48; attempt++) {
      const angle = baseAngle + attempt * goldenAngle;
      const radius = minimumDistance + Math.floor(attempt / 16) * (group.radius * 0.45 + 3);
      const candidate = { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
      if (placed.every(other => Math.hypot(candidate.x - other.center.x, candidate.z - other.center.z) >= group.radius + other.radius + 2)) { next = candidate; break; }
    }
    if (!next) next = { x: Math.cos(baseAngle) * minimumDistance, z: Math.sin(baseAngle) * minimumDistance };
    const dx = next.x - group.center.x, dz = next.z - group.center.z;
    group.center.x = next.x; group.center.z = next.z;
    for (const id of group.memberIds) { const position = layout.positions.get(id); position.x += dx; position.z += dz; }
    placed.push(group);
  }
}

function arrangeHistoryOrbits(groups, visits, sourcePositions) {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const positions = new Map();
  const groupOf = new Map();
  const orbitGroups = groups.map((group, index) => {
    const members = visits.filter(visit => group.memberIds.includes(visit.id))
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const points = members.map(visit => sourcePositions.get(visit.id)).filter(Boolean);
    if (!points.length) return null;

    const minX = Math.min(...points.map(point => point.x));
    const maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxY = Math.max(...points.map(point => point.y));
    const width = Math.min(10, Math.max(3.2, Math.sqrt(members.length) * 2.1));
    const height = Math.min(9, Math.max(3.2, Math.sqrt(members.length) * 1.9));
    const angle = index * goldenAngle + Math.PI * .12;
    const orbitRadius = 20 + (index % 2) * 5;
    const radialX = Math.cos(angle), radialZ = Math.sin(angle);
    const tangentX = -radialZ, tangentZ = radialX;
    const center = { x: radialX * orbitRadius, y: Math.sin(index * 1.4) * 1.6, z: radialZ * orbitRadius };

    members.forEach((visit, memberIndex) => {
      const point = sourcePositions.get(visit.id);
      if (!point) return;
      const progressX = maxX === minX ? 0 : (point.x - minX) / (maxX - minX) - .5;
      const progressY = maxY === minY ? 0 : (point.y - minY) / (maxY - minY) - .5;
      // Keep each journey readable as a small branching cluster, oriented along
      // the orbit around the black hole rather than along a date axis.
      const localX = progressX * width;
      const localY = progressY * height + Math.sin(memberIndex * 2.4) * .18;
      positions.set(visit.id, {
        x: center.x + tangentX * localX,
        y: center.y + localY,
        z: center.z + tangentZ * localX
      });
      groupOf.set(visit.id, group.id);
    });

    const radius = Math.max(4.4, Math.hypot(width, height) / 2 + 1.6);
    const memberIds = members.map(visit => visit.id);
    const memberIdSet = new Set(memberIds);
    return {
      ...group,
      center,
      radius,
      memberIds,
      edges: group.edges.filter(([from, to]) => memberIdSet.has(from) && memberIdSet.has(to)),
      labelPosition: { x: center.x + tangentX * (width / 2 + 1), y: center.y + height / 2 + 2, z: center.z + tangentZ * (width / 2 + 1) },
      nebulaSize: { x: width + 5, y: height + 4 }
    };
  }).filter(Boolean);
  return {
    positions,
    groups: orbitGroups,
    groupOf
  };
}

// History and Bookmarks share the same list, timeline and constellation views.
export function createHistoryView({ browser, onVisibilityChange, collection = "history", layout = historyLayout, onEdit, onRemove }) {
  const saved = collection === "bookmarks", unit = saved ? "bookmarks" : "visits";
  const universeTitle = saved ? "Your bookmark universe" : "History of the Universe";
  const sidebarLabel = saved ? "SAVED BOOKMARKS" : "BROWSING HISTORY";
  const root = document.getElementById(collection);
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
  let mode = "universe", visualize = true, timelineIndex = 0, pinnedGroup = null;
  let sceneVisits = [], sceneGroups = [], sceneShape = historyLayout([]), timelineFocusX = 0;
  let shape = historyLayout([]), focusIds = null, focusGroupId = null, detailsDismissed = false;
  let openState = false, openVersion = 0, frame = 0, renderer, camera, controls, labels, stars, backdrop, blackHole, blackHoleRoot, timelineBackdrop, timelineArt;
  let constellations, explorer, arrows = [], flight = null, lastTime = null;
  let explorationPhase = "idle", explorationBusy = false, draggedHistoryGroupId = null;
  let bookmarkPress = null, suppressBookmarkClick = false;
  const bookmarkDragRay = new THREE.Raycaster();
  const bookmarkDragPointer = new THREE.Vector2();
  const bookmarkDragPlane = new THREE.Plane();
  const bookmarkDragHit = new THREE.Vector3();
  const bookmarkDragScratch = new THREE.Vector3();
  const blackHoleScreenCenter = new THREE.Vector3();
  const listeners = new Set();
  const store = {
    get tabs() { return sceneVisits.map(v => ({ ...v, groupId: sceneShape?.groupOf.get(v.id) })); },
    get groups() { return sceneGroups; },
    groupOf: tab => sceneGroups.find(g => g.id === tab.groupId),
    isActive: tab => tab.id === selected,
    subscribe(callback) { listeners.add(callback); callback(); return () => listeners.delete(callback); }
  };
  let scene;
  function bookmarkRayFrom(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    bookmarkDragPointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    bookmarkDragRay.setFromCamera(bookmarkDragPointer, camera);
    return bookmarkDragRay.ray;
  }
  function overBlackHole(event) {
    if (!renderer || !blackHole) return false;
    const center = blackHoleScreenCenter.set(0, 0, 0).project(camera);
    if (!Number.isFinite(center.x) || center.z > 1) return false;
    const rect = renderer.domElement.getBoundingClientRect();
    const x = rect.left + (center.x + 1) * .5 * rect.width;
    const y = rect.top + (1 - center.y) * .5 * rect.height;
    const reach = Math.max(42, blackHole.diskRadius * rect.height / Math.max(1, camera.position.length()));
    return Math.hypot(event.clientX - x, event.clientY - y) <= reach;
  }
  function startBookmarkPress(star, event) {
    if (!saved || !openState || root.dataset.view !== "stars" || mode !== "universe" || event.button !== 0 || bookmarkPress) return;
    bookmarkPress = { star, x: event.clientX, y: event.clientY, dragging: false, over: false, offset: new THREE.Vector3(), autoRotate: controls.autoRotate, controlsEnabled: controls.enabled };
    controls.enabled = false;
    setOrbit(false);
    window.addEventListener("pointermove", moveBookmarkPress);
    window.addEventListener("pointerup", endBookmarkPress);
    window.addEventListener("pointercancel", endBookmarkPress);
  }
  function moveBookmarkPress(event) {
    if (!bookmarkPress) return;
    const press = bookmarkPress, { star } = press;
    if (!press.dragging) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 6) return;
      press.dragging = true;
      stars.grab(star);
      root.classList.add("dragging-star");
      bookmarkDragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(bookmarkDragScratch).clone(), star.root.position);
      if (bookmarkRayFrom(event).intersectPlane(bookmarkDragPlane, bookmarkDragHit)) press.offset.copy(star.root.position).sub(bookmarkDragHit);
    }
    const over = overBlackHole(event);
    if (bookmarkRayFrom(event).intersectPlane(bookmarkDragPlane, bookmarkDragHit)) {
      star.root.position.copy(bookmarkDragHit).add(press.offset);
      if (over) star.root.position.multiplyScalar(.65);
    }
    if (over !== press.over) {
      press.over = over;
      stars.setDoomed(star, over);
      blackHole.lure(over);
      root.classList.toggle("history-bookmark-doom", over);
    }
  }
  async function endBookmarkPress(event) {
    if (!bookmarkPress) return;
    window.removeEventListener("pointermove", moveBookmarkPress);
    window.removeEventListener("pointerup", endBookmarkPress);
    window.removeEventListener("pointercancel", endBookmarkPress);
    const press = bookmarkPress;
    bookmarkPress = null;
    controls.enabled = press.controlsEnabled;
    setOrbit(press.dragging ? false : press.autoRotate);
    blackHole.lure(false);
    root.classList.remove("history-bookmark-doom", "dragging-star");
    if (!press.dragging) return;
    suppressBookmarkClick = true;
    setTimeout(() => { suppressBookmarkClick = false; }, 0);
    const over = event.type !== "pointercancel" && overBlackHole(event);
    stars.setDoomed(press.star, false);
    stars.release(press.star, { stay: over });
    if (!over) return;
    const bookmark = visits.find(visit => String(visit.id) === String(press.star.id));
    if (!bookmark) return;
    const removed = await onRemove?.(bookmark);
    if (removed) {
      selected = null; pinnedGroup = null; focusGroupId = null; day = "all"; detailsDismissed = false;
      refresh(true);
    }
  }
  function initializeScene() {
    if (scene) return;
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x050813);
    scene.fog = new THREE.FogExp2(0x050813, .004);
    timelineBackdrop = new THREE.Group(); timelineBackdrop.visible = false; scene.add(timelineBackdrop);
    timelineArt = new THREE.Group(); timelineArt.visible = false; scene.add(timelineArt);
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
    blackHoleRoot = new THREE.Group(); scene.add(blackHoleRoot);
    blackHole = createBlackHole(blackHoleRoot);
    constellations = createConstellations({ scene, camera, tabs: store,
      positionOf: id => stars?.positionOf(id), onFocus: focusGroup,
      onContextMenu: saved ? undefined : showHistoryGroupMenu,
      onZoomOut: () => zoomOutFromGroup(),
      getFocusedGroupId: () => !saved && mode === "universe" && day === "group" ? pinnedGroup : null,
      onGroupDrag: saved ? undefined : id => {
        draggedHistoryGroupId = id;
        if (!id) { blackHole.lure(false); root.classList.remove("history-group-doom"); }
      },
      emphasisFor: group => focusIds === null || group.memberIds.some(id => focusIds.has(id)) ? 1 : .3 });
    stars = createTabStars({ scene, camera, tabs: store,
      sink: blackHole, isVisible: () => openState && root.dataset.view === "stars",
      onSelect: visit => {
        if (suppressBookmarkClick) { suppressBookmarkClick = false; return; }
        selectHistoryStar(visit.id);
      },
      onPress: saved ? startBookmarkPress : undefined,
      onContextMenu: visit => {
        select(visit.id);
        if (!saved) browser.showHistoryMenu?.(visit.id);
      },
      reducedMotion: () => motion.matches, animateLayout: false,
      emphasisFor: visit => focusIds === null || focusIds.has(visit.id) ? 1 : .28,
      layout: { compute() {
        const positions = new Map([...sceneShape.positions].map(([id, p]) => [id, new THREE.Vector3(p.x, p.y, p.z)]));
        const clusters = new Map(sceneGroups.map(g => [g.id, { ...g, edges: [], center: new THREE.Vector3(g.center.x, g.center.y, g.center.z) }]));
        return { stars: positions, constellations: clusters, extent: Math.max(12, ...[...positions.values()].map(p => p.length())) };
      }}, onLayout: layout => { constellations.sync(layout); drawTrails(); }
    });
    explorer = createExplorerFlight(scene, camera, {
      getArrivalStar: () => {
        let target;
        if (mode === "timeline") {
          camera.updateMatrixWorld(true);
          target = sceneVisits.map(visit => ({ visit, position: stars?.positionOf(visit.id) }))
            .filter(item => item.position)
            .sort((a, b) => a.position.clone().project(camera).x - b.position.clone().project(camera).x)[0]?.visit;
        } else target = sceneVisits.find(visit => visit.id === selected) || sceneVisits[0];
        const position = target && stars?.positionOf(target.id);
        return position ? { id: String(target.id), position } : null;
      },
      getOrbitTargets: () => sceneVisits.map(visit => ({ id: String(visit.id), position: stars?.positionOf(visit.id) })).filter(target => target.position),
      positionOf: id => stars?.positionOf(id)
    });
    // The star component shares Nova view's icon labels and hover behavior.
    const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(); let down;
    function hit(event) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      ray.setFromCamera(pointer, camera); return stars.pick(ray);
    }
    renderer.domElement.addEventListener("pointerdown", event => {
      if (!saved || mode !== "universe") return;
      const star = hit(event);
      if (star) startBookmarkPress(star, event);
    }, { capture: true });
    const surfaces = [renderer.domElement, labels.domElement];
    for (const surface of surfaces) {
      surface.addEventListener("pointerdown", event => {
        down = { x: event.clientX, y: event.clientY, scrollTop: sidebar.scrollTop };
        // Keep CSS2D star and group buttons as the pointer target so their
        // native click handlers can focus the corresponding history group.
        if (!event.target.closest?.(".star-label, .constellation-name, .constellation-zoom-out")) {
          try { surface.setPointerCapture(event.pointerId); } catch { /* optional pointer capture */ }
        }
      });
      surface.addEventListener("pointermove", event => {
        if (mode === "timeline" && down) {
          const deltaX = down.x - event.clientX, deltaY = down.y - event.clientY;
          sidebar.scrollTop = down.scrollTop + (Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX);
          syncTimelineWindowFromSidebar();
        } else if (!down && surface === renderer.domElement) stars.setHovered(hit(event));
      });
      surface.addEventListener("pointerup", event => {
        // The global bookmark drag handler finishes on window after this
        // event bubbles from the canvas. Do not turn a completed drag back
        // into a click if the pointer happened to return near its start.
        if (saved && bookmarkPress?.dragging) { down = null; return; }
        if (down && surface === renderer.domElement && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5) {
          const star = hit(event);
          if (star) selectHistoryStar(star.id);
          else if (mode === "universe" && !saved) {
            ray.setFromCamera(pointer, camera);
            const groupId = constellations.pick(ray);
            if (groupId) focusGroup(groupId);
          }
        }
        down = null;
      });
    }
    renderer.domElement.addEventListener("pointerleave", () => stars.setHovered(null));
    renderer.domElement.addEventListener("dblclick", e => { if (!hit(e)) overview(); });
    renderer.domElement.addEventListener("wheel", event => {
      if (mode !== "timeline") return;
      event.preventDefault(); sidebar.scrollTop += event.deltaY || event.deltaX; syncTimelineWindowFromSidebar();
    }, { passive: false });
    stage.addEventListener("dragover", event => {
      if (saved || !draggedHistoryGroupId || mode !== "universe") return;
      const over = overBlackHole(event);
      blackHole.lure(over);
      root.classList.toggle("history-group-doom", over);
      if (over) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }
    });
    stage.addEventListener("drop", async event => {
      if (saved || !draggedHistoryGroupId || mode !== "universe") return;
      const id = draggedHistoryGroupId;
      draggedHistoryGroupId = null; blackHole.lure(false); root.classList.remove("history-group-doom");
      if (!overBlackHole(event)) return;
      event.preventDefault();
      const group = groups.find(item => String(item.id) === String(id));
      if (!group?.memberIds?.length) return;
      const removed = await browser.deleteHistoryGroup(group.memberIds);
      if (removed) {
        selected = null; pinnedGroup = null; focusGroupId = null; day = "all"; detailsDismissed = false;
        blackHole.feed(Math.min(2.5, .6 + removed * .12)); refresh(true);
      }
    });
    stage.addEventListener("dragleave", event => {
      if (!stage.contains(event.relatedTarget)) { blackHole.lure(false); root.classList.remove("history-group-doom", "history-bookmark-doom"); }
    });
  }
  }
  function drawTrails() {
    for (const item of arrows) {
      scene.remove(item.line, item.arrow); item.line.geometry.dispose(); item.line.material.dispose(); item.arrow.dispose();
    }
    arrows = [];
    const chronological = [...sceneVisits].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const routes = mode === "timeline"
      ? chronological.slice(1).map((visit, index) => ({
          from: chronological[index].id, to: visit.id, kind: "timeline",
          points: [sceneShape.positions.get(chronological[index].id), sceneShape.positions.get(visit.id)]
        }))
      : [];
    for (const route of routes) {
      const points = route.points.filter(Boolean).map(p => new THREE.Vector3(p.x, p.y, p.z));
      if (points.length < 2) continue;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ transparent: true, opacity: .65, depthWrite: false }));
      const b = points.at(-1), direction = b.clone().sub(points.at(-2)).normalize();
      const arrow = new THREE.ArrowHelper(direction, b.clone().addScaledVector(direction, -2.4), .8, 0x82cddd, .65, .45);
      arrow.line.material.visible = false; arrow.cone.material.transparent = true;
      scene.add(line, arrow); arrows.push({ line, arrow, ...route });
    }
    // Universe group relationships are shown by constellation edges rather
    // than separate visit-to-visit routes.
  }
  function disposeGroupContents(group) {
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse?.(object => {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material?.dispose());
      });
    }
  }
  function addTimelineLabel(group, text, className, position) {
    const element = node("span", className, text);
    const label = new CSS2DObject(element);
    label.position.copy(position);
    group.add(label);
  }
  function addBigBangArt(group, x) {
    const burst = new THREE.Group();
    burst.position.x = x;
    const core = new THREE.Mesh(new THREE.SphereGeometry(.66, 24, 18), new THREE.MeshBasicMaterial({ color: 0xfff7e8 }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.05, 24, 18), new THREE.MeshBasicMaterial({ color: 0x8beaff, transparent: true, opacity: .26, side: THREE.BackSide, depthWrite: false }));
    burst.add(core, halo);
    const positions = [];
    const colors = [];
    const palette = [new THREE.Color(0xffd6ba), new THREE.Color(0xf3f8ff), new THREE.Color(0x8bdfff), new THREE.Color(0xb7a6ff)];
    for (let index = 0; index < 144; index++) {
      const angle = index * 2.399963229728653;
      const length = 2.2 + (index % 17) * .48;
      const direction = new THREE.Vector3(Math.sin(angle) * .72, Math.cos(angle), Math.sin(angle * 1.73) * .46).normalize();
      positions.push(direction.x * .9, direction.y * .9, direction.z * .9,
        direction.x * length, direction.y * length, direction.z * length);
      const color = palette[index % palette.length];
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
    const rays = new THREE.BufferGeometry();
    rays.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    rays.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    burst.add(new THREE.LineSegments(rays, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .72, depthWrite: false, blending: THREE.AdditiveBlending })));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.12, .025, 6, 72), new THREE.MeshBasicMaterial({ color: 0xffe5ce, transparent: true, opacity: .7, depthWrite: false }));
    ring.rotation.y = Math.PI / 2;
    burst.add(ring);
    group.add(burst);
  }
  function addModernUniverseArt(group, x) {
    const system = new THREE.Group();
    system.position.x = x;
    system.add(new THREE.AmbientLight(0x8faecd, 1.25));
    const sunLight = new THREE.PointLight(0xffd99c, 58, 45, 2);
    sunLight.position.set(0, .1, 0); system.add(sunLight);
    const addPlanet = (radius, color, point, options = {}) => {
      const planet = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 20), new THREE.MeshStandardMaterial({ color, roughness: .72, metalness: .08, emissive: color, emissiveIntensity: .12 }));
      planet.position.set(...point);
      system.add(planet);
      if (options.ring) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.55, .055, 8, 48), new THREE.MeshBasicMaterial({ color: options.ring, transparent: true, opacity: .68, depthWrite: false }));
        ring.position.copy(planet.position); ring.rotation.set(.55, .2, -.25); system.add(ring);
      }
    };
    addPlanet(1.2, 0xffc974, [0, .1, 0]);
    addPlanet(.55, 0x67c7ed, [-3.1, -.45, .9]);
    addPlanet(.82, 0xc98970, [-1.5, 2.6, -1.4], { ring: 0xf0c89a });
    addPlanet(.48, 0xa9a0f1, [2.3, 2.1, .3]);
    addPlanet(.7, 0x63b799, [3, -.9, -1.2], { ring: 0x9de3d0 });
    addPlanet(.34, 0xe8e9f1, [1.2, -2.4, 1.1]);
    const starGeometry = new THREE.BufferGeometry();
    const starPositions = [];
    for (let index = 0; index < 90; index++) {
      const angle = index * 2.399963229728653;
      const radius = 4 + index % 9;
      starPositions.push(Math.cos(angle) * radius, Math.sin(angle * 1.31) * radius * .5, Math.sin(angle) * radius);
    }
    starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
    system.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xc4e8ff, size: .075, transparent: true, opacity: .9, depthWrite: false })));
    group.add(system);
  }
  function rebuildTimelineBackdrop(count, dayStarts = [], showEraEnds = !saved) {
    if (!timelineBackdrop) return;
    disposeGroupContents(timelineBackdrop);
    disposeGroupContents(timelineArt);
    const span = Math.max(34, (count - 1) * 2.4 + 20);
    const geometry = new THREE.CylinderGeometry(8.8, 2.2, span, 48, 1, true);
    for (const material of [
      new THREE.MeshBasicMaterial({ color: 0x2086a4, transparent: true, opacity: 0.19, side: THREE.DoubleSide, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: 0x5fc7df, transparent: true, opacity: 0.25, side: THREE.DoubleSide, wireframe: true, depthWrite: false })
    ]) {
      const shell = new THREE.Mesh(geometry, material); shell.rotation.z = -Math.PI / 2; timelineBackdrop.add(shell);
    }
    for (let index = 0; index < 9; index++) {
      const progress = index / 8, radius = 2.2 + progress * 6.6;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035, 6, 64), new THREE.MeshBasicMaterial({
        color: index === 8 ? 0xb4e9ff : 0x75cfe4, transparent: true, opacity: index === 8 ? 0.72 : 0.32,
        side: THREE.DoubleSide, depthWrite: false
      }));
      ring.rotation.y = Math.PI / 2; ring.position.x = -span / 2 + progress * span; timelineBackdrop.add(ring);
    }
    for (const marker of showEraEnds ? dayStarts : []) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(marker.x, -7.2, .2), new THREE.Vector3(marker.x, 7.2, .2)
      ]), new THREE.LineBasicMaterial({ color: 0x8be7ff, transparent: true, opacity: .4, depthWrite: false }));
      timelineBackdrop.add(line);
      addTimelineLabel(timelineBackdrop, `${dateLabel(marker.key)} · ${clock(marker.at)}`, "history-era-date", new THREE.Vector3(marker.x, 8.1, .2));
    }
    if (showEraEnds) {
      const firstGridPoint = -((count - 1) * 1.2);
      addBigBangArt(timelineArt, firstGridPoint - 14);
      addModernUniverseArt(timelineArt, span / 2 - 4.2);
    }
  }
  function setSceneData() {
    if (!renderer) return;
    blackHoleRoot.visible = mode === "universe";
    if (mode === "timeline") {
      const chronological = [...visible].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
      timelineIndex = Math.max(0, Math.min(timelineIndex, Math.max(0, chronological.length - TIMELINE_WINDOW_SIZE)));
      const windowVisits = chronological.slice(timelineIndex, timelineIndex + TIMELINE_WINDOW_SIZE);
      const positions = new Map();
      const dayStarts = [];
      const golden = Math.PI * (3 - Math.sqrt(5));
      windowVisits.forEach((visit, index) => {
        const ageIndex = timelineIndex + index;
        const progress = chronological.length > 1 ? ageIndex / (chronological.length - 1) : 1;
        const radius = 2.2 + progress * 6.5, angle = ageIndex * golden;
        positions.set(visit.id, {
          x: (ageIndex - (chronological.length - 1) / 2) * 2.4,
          y: Math.sin(angle) * radius * 0.32,
          z: Math.cos(angle) * radius * 0.52
        });
        const key = dateKey(visit.at);
        if (index === 0 || dateKey(windowVisits[index - 1].at) !== key) {
          dayStarts.push({ key, at: visit.at, x: positions.get(visit.id).x });
        }
      });
      sceneVisits = windowVisits; sceneGroups = [];
      sceneShape = { positions, groupOf: new Map(), groups: [] };
      timelineFocusX = windowVisits.length
        ? windowVisits.reduce((sum, visit) => sum + positions.get(visit.id).x, 0) / windowVisits.length : 0;
      rebuildTimelineBackdrop(chronological.length, dayStarts, !saved);
      timelineBackdrop.visible = visible.length > 0;
      timelineArt.visible = !saved && visible.length > 0;
    } else {
      const activityById = new Map(visits.map(visit => [visit.id, visit.at]));
      const recent = [...groups].sort((a, b) => {
        const latest = group => Math.max(...group.memberIds.map(id => activityById.get(id) || 0));
        return latest(b) - latest(a);
      }).slice(0, 10);
      const selectedGroup = pinnedGroup || (selected && shape.groupOf.get(selected));
      if (selectedGroup && !recent.some(group => group.id === selectedGroup)) {
        const group = groups.find(item => item.id === selectedGroup);
        if (group) recent.splice(9, 1, group);
      }
      const allowed = new Set(recent.map(group => group.id));
      sceneVisits = visible.filter(visit => allowed.has(shape.groupOf.get(visit.id)));
      sceneShape = arrangeHistoryOrbits(recent, sceneVisits, shape.positions);
      sceneGroups = sceneShape.groups;
      timelineBackdrop.visible = false;
      timelineArt.visible = false;
    }
    listeners.forEach(callback => callback());
    drawTrails();
  }
  function syncTimelineWindowFromSidebar() {
    if (mode !== "timeline") return;
    const rows = sidebar.querySelectorAll("[data-timeline-index]");
    const first = [...rows].find(row => row.getBoundingClientRect().bottom > sidebar.getBoundingClientRect().top);
    if (!first) return;
    const firstIndex = Number(first.dataset.timelineIndex) || 0;
    const next = Math.max(0, Math.min(firstIndex - TIMELINE_WINDOW_END, Math.max(0, visible.length - TIMELINE_WINDOW_SIZE)));
    if (next !== timelineIndex) { timelineIndex = next; setSceneData(); }
  }
  function focusDate(key) {
    day = key; selected = null; detailsDismissed = false; timelineIndex = Number.MAX_SAFE_INTEGER; refresh(true);
    sidebar.querySelector(`[data-visit-id="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }
  function showAllHistory() {
    day = "all"; selected = null; pinnedGroup = null; focusGroupId = null;
    detailsDismissed = false; search.value = ""; entryLimit = 100; refresh(true); search.focus();
  }
  function overview() { day = "all"; selected = null; pinnedGroup = null; focusGroupId = null; detailsDismissed = false; timelineIndex = Number.MAX_SAFE_INTEGER; refresh(true); }
  function zoomOutFromGroup() {
    day = "all"; selected = null; pinnedGroup = null; focusGroupId = null; detailsDismissed = false;
    timelineIndex = Number.MAX_SAFE_INTEGER; refresh(false);
    if (!renderer || mode !== "universe") return;
    const points = [...sceneShape.positions.values(), new THREE.Vector3(0, 0, 0)];
    const view = viewFor(points);
    flight = view; setOrbit(false);
  }
  function focusGroup(id, visitId = null) {
    const group = groups.find(g => g.id === id); if (!group) return;
    pinnedGroup = id;
    day = "group"; focusGroupId = id; selected = visitId && group.memberIds.includes(visitId) ? visitId : group.memberIds.at(-1); detailsDismissed = false; refresh(false);
    if (renderer) {
      const view = viewFor(group.memberIds.map(id => sceneShape.positions.get(id) || shape.positions.get(id)));
      flight = view; setOrbit(false);
    }
  }
  function selectHistoryStar(id) {
    if (!saved && mode === "universe") {
      const groupId = sceneShape.groupOf.get(id) || shape.groupOf.get(id);
      const alreadyFocused = groupId != null && String(pinnedGroup) === String(groupId) && day === "group" && String(focusGroupId) === String(groupId);
      if (groupId != null && !alreadyFocused) { focusGroup(groupId, id); return; }
    }
    void openVisit(id);
  }
  function showHistoryGroupMenu(groupId) {
    if (saved) return;
    const group = sceneGroups.find(item => String(item.id) === String(groupId)) || groups.find(item => String(item.id) === String(groupId));
    if (!group) return;
    const memberIds = new Set(group.memberIds);
    const latest = visits.filter(visit => memberIds.has(visit.id)).sort((a, b) => b.at - a.at)[0];
    if (latest) browser.showHistoryMenu?.(latest.id);
  }
  function startExploration() {
    if (!explorationBusy || !openState || root.dataset.view !== "stars" || !explorer) return;
    if (explorationPhase === "active") return;
    if (explorationPhase === "exiting") { explorer.cancel(); root.classList.remove("history-exploration-exiting"); }
    explorationPhase = "active";
    root.classList.add("history-exploring");
    explorer.start({ timeline: mode === "timeline" });
    if (!frame) { lastTime = null; frame = requestAnimationFrame(tick); }
  }
  function setExploring(busy) {
    explorationBusy = Boolean(busy);
    if (explorationBusy) { startExploration(); return; }
    if (explorationPhase !== "active") return;
    explorationPhase = "exiting";
    root.classList.add("history-exploration-exiting");
    explorer?.finish();
  }
  function restartExploration() {
    if (!explorationBusy || !openState || !explorer || root.dataset.view !== "stars") return;
    explorer.cancel(); explorationPhase = "idle";
    root.classList.remove("history-exploring", "history-exploration-exiting");
    startExploration();
  }
  function finishExploration() {
    explorationPhase = "idle";
    root.classList.remove("history-exploring", "history-exploration-exiting");
  }
  function pathTo(id) {
    const ancestors = new Set(); const byId = new Map(visits.map(v => [v.id, v]));
    while (id && !ancestors.has(id)) { ancestors.add(id); id = byId.get(id)?.parent; }
    return ancestors;
  }
  function select(id, focus = false) {
    if (mode === "timeline") {
      const chronological = [...visible].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
      const index = chronological.findIndex(visit => visit.id === id);
      if (index >= 0) timelineIndex = Math.max(0, Math.min(index - TIMELINE_WINDOW_CENTER, Math.max(0, visible.length - TIMELINE_WINDOW_SIZE)));
    }
    if (mode === "universe") pinnedGroup = shape.groupOf.get(id) || null;
    selected = id; day = "visit"; focusGroupId = shape.groupOf.get(id); detailsDismissed = false; refresh(false);
    if (focus && renderer && mode !== "timeline") {
      const p = sceneShape.positions.get(id) || shape.positions.get(id); if (p) {
        const distance = Math.min(50, camera.position.distanceTo(controls.target));
        flight = { target: new THREE.Vector3(p.x, p.y, p.z), offset: new THREE.Vector3(0, 0, distance) }; setOrbit(false);
      }
    }
  }
  let openingVisit = null;
  let openingTimer = 0;
  async function openVisit(id) {
    // A quick double-click should not create two copies of the same page.
    if (openingVisit === id) return;
    openingVisit = id;
    clearTimeout(openingTimer);
    openingTimer = setTimeout(() => { openingVisit = null; }, 500);
    const version = openVersion;
    if (await browser.openHistory(id) && version === openVersion) close();
  }
  function showDetails() {
    details.replaceChildren(); const visit = visits.find(v => v.id === selected);
    details.hidden = !visit || detailsDismissed; if (!visit || detailsDismissed) return;
    const top = node("div", "history-detail-heading");
    top.append(node("span", "cosmos-title", saved ? "BOOKMARK DETAILS" : "VISIT DETAILS"));
    const dismiss = node("button", "history-quiet", "×"); dismiss.setAttribute("aria-label", saved ? "Close bookmark details" : "Close visit details");
    dismiss.onclick = () => { selected = null; detailsDismissed = true; refresh(false); }; top.append(dismiss);
    details.append(top, node("h2", "", visit.title || host(visit.url)), node("p", "history-detail-url", visit.url), node("p", "history-detail-time", `${dateLabel(dateKey(visit.at))} · ${clock(visit.at)}`));
    const open = node("button", "history-open", visit.liveTabId ? "Return to open tab ↗" : saved ? "Open bookmark ↗" : "Reopen this page ↗"); open.onclick = () => openVisit(visit.id); details.append(open);
    if (saved) details.append(bookmarkActions(visit));
    const linked = saved
      ? visits.filter(v => v.id !== visit.id && host(v.url).replace(/^www\./, "") === host(visit.url).replace(/^www\./, ""))
      : [visits.find(v => v.id === visit.parent), ...visits.filter(v => v.parent === visit.id)].filter(Boolean);
    if (linked.length) details.append(node("h3", "cosmos-title", saved ? "SAME WEBSITE" : "CONNECTED VISITS"));
    for (const v of linked.slice(0, 8)) {
      const relation = saved ? "Saved" : v.id === visit.parent ? "From" : v.kind === "new-tab" ? "New tab" : "To";
      const button = node("button", "history-related", `${relation} · ${clock(v.at)} · ${v.title || host(v.url)}`);
      button.onclick = saved ? () => select(v.id, true) : () => { search.value = ""; entryLimit = Math.max(100, visits.length); selected = null; day = "all"; refresh(false); entries.querySelector(`[data-visit-id="${v.id}"]`)?.scrollIntoView({ block: "center" }); }; details.append(button);
    }
    details.append(node("p", "history-note", saved ? "Saved on this device. Connections group bookmarks from the same website." : "Saved visit information. Reopening loads the current version of the page."));
  }
  function bookmarkActions(visit) {
    const actions = node("div", "bookmark-actions");
    for (const [label, action] of [["Edit", onEdit], ["Remove", onRemove]]) {
      const button = node("button", "history-quiet bookmark-" + label.toLowerCase(), label);
      button.type = "button"; button.setAttribute("aria-label", `${label} bookmark: ${visit.title || host(visit.url)}`);
      button.onclick = () => action?.(visit); actions.append(button);
    }
    return actions;
  }
  function renderSidebar() {
    const focused = document.activeElement?.dataset.visitId;
    sidebar.replaceChildren();
    if (mode === "timeline") {
      const chronological = [...visible].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
      const indices = new Map(chronological.map((visit, index) => [visit.id, index]));
      const sections = new Map();
      const newestFirst = [...visible].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
      newestFirst.forEach(visit => {
        const key = dateKey(visit.at);
        if (!sections.has(key)) {
          const section = node("section", "history-timeline-day");
          const heading = node("div", "history-timeline-date");
          heading.append(node("span", "", dateLabel(key)), node("small", "history-timeline-count", "0"));
          section.append(heading); sidebar.append(section); sections.set(key, section);
        }
        const button = node("button", "cosmos-info-tab history-timeline-item" + (visit.id === selected ? " active" : ""));
        button.dataset.visitId = visit.id;
        button.setAttribute("aria-current", String(visit.id === selected));
        button.dataset.timelineIndex = String(indices.get(visit.id) || 0);
        button.classList.toggle("history-context-row", focusIds !== null && !focusIds.has(visit.id));
        button.title = `${visit.title}\n${visit.url}\n${new Date(visit.at).toLocaleString()}`;
        const time = node("span", "history-visit-clock");
        time.append(node("small", "", new Date(visit.at).toLocaleDateString([], { month: "short", day: "numeric" })));
        time.append(node("span", "", clock(visit.at))); button.append(time);
        const mark = node("span", "cosmos-info-favicon");
        if (visit.favicon) { const image = document.createElement("img"); image.src = visit.favicon; image.alt = ""; mark.append(image); }
        else mark.textContent = host(visit.url).slice(0, 1).toUpperCase();
        const copy = node("span", "cosmos-info-copy");
        copy.append(node("span", "cosmos-info-title", visit.title || host(visit.url)), node("span", "cosmos-info-url", host(visit.url)));
        button.append(mark, copy); button.onclick = () => select(visit.id, true); button.ondblclick = () => openVisit(visit.id);
        if (!saved) button.oncontextmenu = event => { event.preventDefault(); browser.showHistoryMenu?.(visit.id); };
        sections.get(key).append(button);
        sections.get(key).querySelector(".history-timeline-count").textContent = String(Number(sections.get(key).querySelector(".history-timeline-count").textContent) + 1);
      });
      if (focused) sidebar.querySelector(`[data-visit-id="${focused}"]`)?.focus({ preventScroll: true });
      return;
    }
    for (const group of [...groups].sort((a, b) => b.lastAt - a.lastAt)) {
      const section = node("section", "cosmos-list-group");
      section.style.setProperty("--group-color", group.color);
      const heading = node("button", "cosmos-group-heading");
      heading.append(node("span", "cosmos-group-dot"), node("span", "cosmos-group-name", group.name), node("span", "cosmos-group-count", String(group.memberIds.length)));
      heading.title = `${group.name} · ${saved ? "Focus website bookmarks" : "Focus navigation journey · Right-click for history actions"}`;
      heading.onclick = () => focusGroup(group.id); section.append(heading);
      if (!saved) heading.oncontextmenu = event => { event.preventDefault(); event.stopPropagation(); showHistoryGroupMenu(group.id); };
      const ids = new Set(group.memberIds);
      for (const visit of visible.filter(v => ids.has(v.id)).sort((a, b) => b.at - a.at)) {
        const button = node("button", "cosmos-info-tab" + (visit.id === selected ? " active" : "")); button.dataset.visitId = visit.id;
        button.setAttribute("aria-current", String(visit.id === selected));
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
        button.append(mark, copy); button.onclick = () => mode === "universe" ? selectHistoryStar(visit.id) : select(visit.id, true); button.ondblclick = () => openVisit(visit.id);
        if (!saved) button.oncontextmenu = event => { event.preventDefault(); browser.showHistoryMenu?.(visit.id); };
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
      link.onclick = event => {
        event.preventDefault();
        if (!saved && (event.ctrlKey || event.metaKey || event.shiftKey)) {
          void browser.openHistory(visit.id, { newTab: true, activate: event.shiftKey });
        } else void openVisit(visit.id);
      };
      link.onauxclick = event => {
        if (saved || event.button !== 1) return;
        event.preventDefault(); void browser.openHistory(visit.id, { newTab: true, activate: false });
      };
      if (!saved) link.oncontextmenu = event => { event.preventDefault(); browser.showHistoryMenu?.(visit.id); };
      if (saved) {
        const row = node("div", "bookmark-entry-row"); row.append(link, bookmarkActions(visit)); sections.get(key).append(row);
      } else sections.get(key).append(link);
    }
    root.querySelector(".history-list-count").textContent = `${Math.min(entryLimit, visits.length)} of ${visits.length} ${unit}`;
    root.querySelector(".history-list-empty").hidden = visits.length > 0;
    root.querySelector(".history-load-more").hidden = entryLimit >= visits.length;
  }
  function setMode(next) {
    if (next !== mode) { day = "all"; selected = null; pinnedGroup = null; focusGroupId = null; detailsDismissed = false; }
    if (saved) { mode = "universe"; visualize = true; }
    else if (next === "list") { mode = "universe"; visualize = false; }
    else { mode = next === "timeline" ? "timeline" : "universe"; visualize = true; }
    timelineIndex = mode === "timeline" ? Number.MAX_SAFE_INTEGER : 0;
    root.classList.toggle("timeline-mode", mode === "timeline" && visualize);
    root.querySelectorAll(".history-mode").forEach(button => {
      const active = button.dataset.mode === (visualize ? mode : "list");
      button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active));
    });
    const timeline = mode === "timeline" && visualize;
    if (saved) root.querySelector(".history-legend > span").replaceChildren(node("i", ""), document.createTextNode(timeline ? "Saved order" : "Same website"));
    root.querySelector(".history-rotation").hidden = timeline;
    root.querySelector(".history-fit").hidden = timeline;
    root.querySelector(".cosmos-sidebar").setAttribute("aria-label", timeline ? (saved ? "Bookmarks by date saved" : "Chronological browsing history") : saved ? "Bookmarks by website" : "Navigation journeys");
    root.querySelector(".cosmos-hint").textContent = timeline
      ? "Scroll either side to move through time · Click a star to open · Click a sidebar row to inspect"
      : saved
        ? "Drag a bookmark to the black hole to remove it · Click to open · Drag to rotate · Scroll to zoom"
        : "Click a star or group name to focus a journey · Click a focused tab to open · Drag to rotate · Scroll to zoom";
    refresh(true);
    restartExploration();
  }
  function setView(searching) {
    const previous = root.dataset.view;
    root.dataset.view = searching ? "stars" : "list";
    const selectedMode = searching ? mode : visualize ? mode : "list";
    root.classList.toggle("timeline-mode", searching && mode === "timeline");
    root.querySelectorAll(".history-mode").forEach(button => {
      const active = button.dataset.mode === selectedMode;
      button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active));
    });
    stage.hidden = !searching; root.querySelector(".cosmos-sidebar").hidden = !searching; listView.hidden = searching;
    clearSearch.hidden = !search.value;
    root.querySelector(".history-view-caption").textContent = searching
      ? search.value.trim() ? "Search results, connected" : mode === "timeline" || mode === "universe" ? universeTitle : "Navigation journeys"
      : saved ? "Your saved pages" : "Your recent browsing";
    if (searching) {
      initializeScene();
      if (renderer && !frame) { lastTime = null; frame = requestAnimationFrame(tick); }
      if (explorationBusy) startExploration();
    } else {
      cancelAnimationFrame(frame); frame = 0; lastTime = null;
      if (previous === "stars") listView.scrollTop = 0;
    }
  }
  function refresh(refit = false) {
    if (!openState) return;
    const query = search.value.trim().toLowerCase();
    if (!query && !visualize) {
      setView(false); visible = []; groups = []; shape = historyLayout([]); focusIds = null; selected = null;
      sceneVisits = []; sceneGroups = []; sceneShape = historyLayout([]); timelineIndex = 0;
      root.dataset.focusMode = "list"; root.dataset.focusVisit = "";
      listeners.forEach(callback => callback()); sidebar.replaceChildren(); dates.replaceChildren(); details.hidden = true;
      renderEntries(); return;
    }
    const keys = [...new Set(visits.map(v => dateKey(v.at)))].sort().reverse();
    dates.replaceChildren();
    const recent = node("button", "history-date", saved ? "← All bookmarks" : "← Back to history"); recent.onclick = showAllHistory; dates.append(recent);
    const all = node("button", "history-date" + (day === "all" ? " active" : ""), "All dates"); all.onclick = overview; dates.append(all);
    for (const key of keys) {
      const button = node("button", "history-date" + (day === key ? " active" : "")); button.dataset.date = key;
      button.append(node("span", "", dateLabel(key)), node("small", "", String(visits.filter(v => dateKey(v.at) === key).length)));
      button.onclick = () => focusDate(key); dates.append(button);
      if (!saved) button.oncontextmenu = event => { event.preventDefault(); browser.showHistoryDateMenu?.(key); };
    }
    search.placeholder = saved ? "Search bookmarks" : "Search all history";
    const filtered = visits.filter(v => (!keys.includes(day) || dateKey(v.at) === day) && `${v.title} ${v.url}`.toLowerCase().includes(query)).sort((a,b) => a.at - b.at || a.id.localeCompare(b.id));
    visible = filtered;
    if (selected && !visible.some(v => v.id === selected)) selected = null;
    shape = layout(visible, visits); clearBlackHoleLane(shape); groups = shape.groups;
    const focusedDay = keys.includes(day) ? day : null;
    if (focusedDay && !detailsDismissed) selected = [...visible].reverse().find(v => dateKey(v.at) === focusedDay)?.id || null;
    if (day === "visit" && selected) focusGroupId = shape.groupOf.get(selected);
    focusIds = day === "all" ? null : new Set(visible.filter(v => focusedDay ? dateKey(v.at) === focusedDay : shape.groupOf.get(v.id) === focusGroupId).map(v => v.id));
    root.dataset.focusMode = day === "all" || day === "visit" || day === "group" ? day : "date";
    root.dataset.focusVisit = selected || "";
    title.textContent = focusedDay ? dateLabel(focusedDay) : query ? "Search constellations" : mode === "timeline" || mode === "universe" ? universeTitle : "Navigation journeys";
    root.querySelector(".history-sidebar-heading .cosmos-title").textContent = query ? "SEARCH RESULTS" : sidebarLabel;
    root.querySelector(".cosmos-sidebar").setAttribute("aria-label", saved ? "Bookmarks by website and date saved" : mode === "timeline" ? "Chronological browsing history" : query ? "Matching navigation journeys" : "Browsing history grouped by journey");
    root.querySelector(".history-count").textContent = query ? `${visible.length} of ${visits.length} ${unit}` : `${visible.length} ${unit}`;
    empty.hidden = visible.length > 0;
    empty.textContent = visits.length ? "No pages match your search. Try a title or website address." : saved ? "Save a page with the address-bar star or Ctrl+D to start your bookmark universe." : "Your browsing history will appear here.";
    setView(true);
    setSceneData();
    root.querySelector(".history-summary").textContent = mode === "timeline"
      ? `Showing ${Math.min(TIMELINE_WINDOW_SIZE, visible.length)} of ${visible.length} ${unit} · scroll either side to move through time`
      : `Showing ${sceneGroups.length} of ${groups.length} ${saved ? "website constellations" : "connected journeys"} · newest first`;
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
    const orbitCameraDirection = new THREE.Vector3(0, .8, .7).normalize();
    const screenHeight = size.y * .658 + size.z * .753;
    const distance = Math.max(42, (screenHeight + 36) / (2 * tangent), (size.x + 36) / (2 * tangent * aspect));
    return { target, offset: orbitCameraDirection.multiplyScalar(distance) };
  }
  function fit() {
    if (!renderer) return; resize(); flight = null;
    if (mode === "timeline") {
      controls.enabled = false; controls.autoRotate = false;
      controls.target.set(timelineFocusX, 0, 0);
      camera.position.set(timelineFocusX, 34, 56); camera.lookAt(controls.target);
      scene.fog.density = .004; setOrbit(false); return;
    }
    controls.enabled = true;
    const points = [...sceneShape.positions.values()];
    if (blackHoleRoot?.visible) points.push({ x: 0, y: 0, z: 0 });
    const { target, offset } = viewFor(points);
    const distance = offset.length();
    controls.maxDistance = Math.max(4000, distance * 3);
    camera.far = Math.max(10000, distance * 5); camera.updateProjectionMatrix();
    controls.target.copy(target); camera.position.copy(target).add(offset);
    scene.fog.density = .12 / distance;
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
    if (mode === "timeline") {
      const blend = motion.matches ? 1 : 1 - Math.exp(-dt * 5);
      controls.target.x += (timelineFocusX - controls.target.x) * blend;
      camera.position.x += (timelineFocusX - camera.position.x) * blend;
    }
    controls.update(dt); backdrop.update(motion.matches ? 0 : time); stars.update(time);
    blackHole.update(time);
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
    const ended = explorer ? explorer.update(time, dt) : false;
    renderer.render(scene, camera); labels.render(scene, camera);
    if (explorationPhase === "exiting" && ended) finishExploration();
    if (timelineArt?.visible && timelineArt.children[0]) {
      const modern = timelineArt.children.find(child => child.type === "Group" && child.children.some(part => part.isPoints));
      if (modern) modern.rotation.y = Math.sin(time * .08) * .045;
    }
  }
  function setOrbit(enabled) {
    if (controls) controls.autoRotate = enabled && !motion.matches;
    const button = root.querySelector(".history-rotation");
    button.textContent = controls?.autoRotate ? "Pause rotation" : "Resume rotation";
    button.setAttribute("aria-pressed", String(Boolean(controls?.autoRotate)));
  }
  root.querySelector(".history-rotation").onclick = () => setOrbit(!controls?.autoRotate);
  motion.addEventListener("change", () => { if (motion.matches) setOrbit(false); if (controls) controls.enableDamping = !motion.matches; });
  const sidebarToggle = root.querySelector(".history-sidebar-toggle");
  function setSidebarHidden(hidden) {
    root.classList.toggle("sidebar-hidden", hidden);
    root.querySelector(".cosmos-sidebar").inert = hidden;
    sidebarToggle.setAttribute("aria-expanded", String(!hidden));
    sidebarToggle.title = hidden ? (saved ? "Show bookmarks list" : "Show history list") : saved ? "Hide bookmarks list" : "Hide history list";
    sidebarToggle.setAttribute("aria-label", sidebarToggle.title);
    try { localStorage.setItem(`nova.${collection}.sidebarHidden`, hidden ? "1" : "0"); } catch { /* storage unavailable */ }
  }
  let sidebarHidden = false;
  try { sidebarHidden = localStorage.getItem(`nova.${collection}.sidebarHidden`) === "1"; } catch { /* storage unavailable */ }
  setSidebarHidden(sidebarHidden);
  sidebarToggle.onclick = () => { setSidebarHidden(!root.classList.contains("sidebar-hidden")); fit(); };
  root.querySelectorAll(".history-mode").forEach(button => { button.onclick = () => setMode(button.dataset.mode); });
  sidebar.addEventListener("scroll", syncTimelineWindowFromSidebar, { passive: true });
  root.querySelector(".history-fit").onclick = overview;
  clearSearch.onclick = showAllHistory;
  root.querySelector(".history-load-more").onclick = () => { entryLimit += 100; renderEntries(); };
  root.querySelector(".history-close").onclick = close;
  search.oninput = () => { day = "all"; selected = null; focusGroupId = null; pinnedGroup = null; detailsDismissed = false; timelineIndex = Number.MAX_SAFE_INTEGER; refresh(true); };
  root.addEventListener("keydown", event => {
    if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(event.key) && sidebar.contains(event.target)) {
      const current = event.target.closest("[data-visit-id]");
      if (current) {
        const rows = [...sidebar.querySelectorAll("button[data-visit-id]")];
        const index = rows.indexOf(current);
        const amount = event.key === "PageDown" ? 8 : event.key === "PageUp" ? -8 : event.key === "Home" ? -Infinity : event.key === "End" ? Infinity : event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + amount));
        const next = rows[nextIndex];
        event.preventDefault();
        if (next) {
          next.focus();
          select(next.dataset.visitId, true);
        }
        return;
      }
    }
    if (event.key === "Escape" && event.target === search && search.value) {
      event.preventDefault(); event.stopPropagation(); showAllHistory(); return;
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
    if (openState) return; openState = true; openVersion++; openingVisit = null; clearTimeout(openingTimer);
    confirm.hidden = true;
    root.hidden = false; onVisibilityChange(true);
    day = "all"; selected = null; detailsDismissed = false; search.value = ""; entryLimit = 100;
    refresh(true); listView.scrollTop = 0; sidebar.scrollTop = 0; search.focus();
    if (explorationBusy) startExploration();
  }
  function close() {
    if (!openState) return; openState = false; root.hidden = true; cancelAnimationFrame(frame); frame = 0; onVisibilityChange(false);
    explorer?.cancel(); finishExploration();
    document.getElementById(`${collection}-tab`).focus();
  }
  return { open, close, toggle: () => openState ? close() : open(), isOpen: () => openState, setExploring };
}
