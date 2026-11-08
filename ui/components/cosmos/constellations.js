import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { glowTexture } from "./textures.js";

// Connects stars the way star charts do: the shortest set of lines that
// links every star once (a minimum spanning tree), so it reads as a figure
// rather than a web.
function spanningTree(ids, positions) {
  if (ids.length < 2) return [];
  const inTree = new Set([ids[0]]);
  const edges = [];
  while (inTree.size < ids.length) {
    let best = null;
    for (const from of inTree) {
      for (const to of ids) {
        if (inTree.has(to)) continue;
        const length = positions.get(from).distanceToSquared(positions.get(to));
        if (!best || length < best.length) best = { from, to, length };
      }
    }
    inTree.add(best.to);
    edges.push([best.from, best.to]);
  }
  return edges;
}

// Draws each tab group as a constellation: lines between its stars, a faint
// nebula behind them and its name above. In Nova, the name can be dragged to
// another group to merge them, clicked to focus, or double-clicked to rename.
export function createConstellations({ scene, camera, tabs, positionOf, onFocus, onRename, onMerge, onGroupDrag, emphasisFor = () => 1 }) {
  const root = new THREE.Group();
  scene.add(root);
  const items = new Map();
  let pendingEdit = null;
  let highlighted = null;
  let draggedGroupId = null;
  let suppressGroupClick = false;
  const GROUP_DRAG_TYPE = "application/x-nova-constellation";

  function createItem(group) {
    const geometry = new THREE.BufferGeometry();
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    const nebula = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending
    }));

    const element = document.createElement("div");
    element.className = "constellation-label";
    element.innerHTML = '<span class="constellation-name" role="button" tabindex="0" title="Click to focus · Double-click to rename"></span>';
    const button = element.firstChild;
    button.dataset.groupId = String(group.id);
    const label = new CSS2DObject(element);

    root.add(lines, nebula, label);
    const item = { id: group.id, group, geometry, lines, nebula, label, element, button, edges: [], radius: 1, editing: false, center: new THREE.Vector3(), seed: Math.random() * 10 };

    button.addEventListener("click", () => {
      if (suppressGroupClick) { suppressGroupClick = false; return; }
      if (!item.editing) onFocus(item.id);
    });
    button.title = [
      onMerge ? "Drag the name onto another group to merge" : null,
      onGroupDrag && !onMerge ? "Drag this journey to the black hole to delete it" : null,
      onRename ? "Click to focus · Double-click to rename" : "Click to focus this navigation journey"
    ].filter(Boolean).join(" · ");
    if (onMerge || onGroupDrag) {
      button.classList.add("merge-handle");
      button.draggable = true;
      button.addEventListener("pointerdown", () => { suppressGroupClick = false; });
      button.addEventListener("dragstart", event => {
        if (item.editing || !event.dataTransfer) { event.preventDefault(); return; }
        draggedGroupId = String(item.id);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(GROUP_DRAG_TYPE, draggedGroupId);
        event.dataTransfer.setData("text/plain", draggedGroupId);
        onGroupDrag?.(draggedGroupId);
        item.element.classList.add("dragging");
      });
      if (onMerge) {
        button.addEventListener("dragover", event => {
          if (!draggedGroupId || String(item.id) === draggedGroupId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          item.element.classList.add("merge-target");
        });
        button.addEventListener("dragleave", event => {
          if (!button.contains(event.relatedTarget)) item.element.classList.remove("merge-target");
        });
        button.addEventListener("drop", event => {
          event.preventDefault();
          const sourceId = event.dataTransfer?.getData(GROUP_DRAG_TYPE) || draggedGroupId;
          item.element.classList.remove("merge-target");
          if (sourceId && String(sourceId) !== String(item.id)) onMerge(sourceId, item.id);
        });
      }
      button.addEventListener("dragend", () => {
        item.element.classList.remove("dragging");
        for (const candidate of items.values()) candidate.element.classList.remove("merge-target");
        draggedGroupId = null;
        onGroupDrag?.(null);
        suppressGroupClick = true;
        setTimeout(() => { suppressGroupClick = false; }, 500);
      });
    }
    button.addEventListener("dblclick", () => { if (onRename) editName(item.id); });
    button.addEventListener("keydown", (event) => {
      if (!item.editing && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault(); onFocus(item.id);
      }
    });
    button.addEventListener("keydown", (event) => {
      if (!item.editing) return;
      event.stopPropagation();
      if (event.key === "Enter") { event.preventDefault(); finishEdit(item, true); }
      if (event.key === "Escape") { event.preventDefault(); finishEdit(item, false); }
    });
    // Clicking elsewhere saves the name; switching to another window doesn't.
    button.addEventListener("blur", () => {
      if (item.editing && document.hasFocus()) finishEdit(item, true);
    });
    return item;
  }

  function removeItem(item) {
    root.remove(item.lines, item.nebula, item.label);
    item.geometry.dispose();
    item.lines.material.dispose();
    item.nebula.material.dispose();
    items.delete(item.id);
  }

  function renderName(item) {
    if (item.editing) return;
    item.button.textContent = item.group.name;
  }

  function editName(groupId) {
    const item = items.get(groupId);
    if (!item) {
      pendingEdit = groupId;
      return;
    }
    pendingEdit = null;
    item.editing = true;
    item.element.classList.add("editing");
    item.button.contentEditable = "plaintext-only";
    // A just-created label isn't on the page until the next frame is drawn.
    if (item.element.isConnected) focusName(item);
    else item.focusPending = true;
  }

  function focusName(item) {
    item.focusPending = false;
    item.button.focus();
    const range = document.createRange();
    range.selectNodeContents(item.button);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function finishEdit(item, save) {
    item.editing = false;
    item.element.classList.remove("editing");
    item.button.contentEditable = "false";
    const name = item.button.textContent.replace(/\s+/g, " ").trim();
    if (save && name && name !== item.group.name) onRename(item.id, name);
    renderName(item);
  }

  return {
    sync(layout) {
      for (const item of Array.from(items.values())) {
        if (!layout.constellations.has(item.id)) removeItem(item);
      }
      for (const group of tabs.groups) {
        const shape = layout.constellations.get(group.id);
        if (!shape) continue;
        const item = items.get(group.id) || createItem(group);
        items.set(group.id, item);
        item.group = group;
        item.nebula.userData.groupId = String(group.id);
        item.radius = shape.radius;
        item.memberIds = shape.memberIds;
        item.labelPosition = shape.labelPosition;
        item.nebulaSize = shape.nebulaSize;
        item.edges = shape.edges ?? spanningTree(shape.memberIds, layout.stars);
        item.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(item.edges.length * 6), 3));
        const color = new THREE.Color(group.color);
        item.lines.material.color.copy(color);
        item.nebula.material.color.copy(color);
        item.element.style.setProperty("--group-color", group.color);
        renderName(item);
      }
      if (pendingEdit && items.has(pendingEdit)) editName(pendingEdit);
    },

    update(time) {
      const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      for (const item of items.values()) {
        if (item.focusPending && item.element.isConnected) focusName(item);
        const buffer = item.geometry.getAttribute("position");
        if (buffer) {
          item.edges.forEach(([from, to], index) => {
            const a = positionOf(from);
            const b = positionOf(to);
            if (a && b) buffer.array.set([a.x, a.y, a.z, b.x, b.y, b.z], index * 6);
          });
          buffer.needsUpdate = true;
          item.geometry.computeBoundingSphere();
        }
        // Follow the stars as they glide into place.
        item.center.set(0, 0, 0);
        let count = 0;
        for (const id of item.memberIds) {
          const position = positionOf(id);
          if (position) { item.center.add(position); count++; }
        }
        if (count) item.center.divideScalar(count);
        item.nebula.position.copy(item.center);
        if (item.nebulaSize) item.nebula.scale.set(item.nebulaSize.x, item.nebulaSize.y, 1);
        else item.nebula.scale.setScalar(item.radius * 3.2 + 8);
        // A star being dragged over it lights the constellation up.
        const lit = item.id === highlighted;
        const emphasis = emphasisFor(item.group);
        item.element.style.opacity = String(emphasis);
        item.nebula.material.opacity = (lit ? 0.24 + Math.sin(time * 6) * 0.05 : 0.09 + Math.sin(time * 0.6 + item.seed) * 0.025) * emphasis;
        item.lines.material.opacity = (lit ? 0.85 : 0.38 + Math.sin(time * 0.9 + item.seed) * 0.1) * emphasis;
        // Just above the constellation on screen.
        if (item.labelPosition) item.label.position.set(item.labelPosition.x, item.labelPosition.y, item.labelPosition.z);
        else item.label.position.copy(item.center).addScaledVector(screenUp, item.radius * 0.75 + 2.5);
      }
    },

    setHighlighted(groupId) {
      if (highlighted === groupId) return;
      if (items.has(highlighted)) items.get(highlighted).element.classList.remove("drop-target");
      highlighted = groupId;
      if (items.has(groupId)) items.get(groupId).element.classList.add("drop-target");
    },
    pick(raycaster) {
      root.updateMatrixWorld(true);
      const hit = raycaster.intersectObjects(Array.from(items.values(), item => item.nebula), false)[0];
      return hit ? String(hit.object.userData.groupId || "") || null : null;
    },
    ids: () => Array.from(items.keys()),
    centerOf: (groupId) => (items.has(groupId) ? items.get(groupId).center.clone() : null),
    radiusOf: (groupId) => (items.has(groupId) ? items.get(groupId).radius : 0),
    editName
  };
}
