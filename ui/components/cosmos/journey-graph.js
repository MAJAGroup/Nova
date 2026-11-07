import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { escapeHTML } from "../../lib/dom.js";
import { domainOf } from "../../lib/url.js";
import { glowTexture } from "./textures.js";

const COLORS = [0x84ddff, 0xaaa0ff, 0xc99cff, 0xffc38c, 0xff9ecb, 0x8fe9c4];

function hash(text) {
  let value = 2166136261;
  for (const character of String(text)) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function graphPositions(snapshot) {
  const visits = snapshot.visits || [];
  const byId = new Map(visits.map((visit) => [visit.id, visit]));
  const parent = new Map();
  for (const visit of visits) if (visit.parentVisitId && byId.has(visit.parentVisitId)) parent.set(visit.id, visit.parentVisitId);
  for (const edge of snapshot.edges || []) {
    if (!byId.has(edge.fromVisitId) || !byId.has(edge.toVisitId) || parent.has(edge.toVisitId)) continue;
    if (edge.kind === "opened-tab" || edge.kind === "restored-tab") parent.set(edge.toVisitId, edge.fromVisitId);
  }

  const children = new Map();
  for (const [child, ancestor] of parent) {
    if (!children.has(ancestor)) children.set(ancestor, []);
    children.get(ancestor).push(byId.get(child));
  }
  for (const list of children.values()) list.sort((a, b) => a.visitedAt - b.visitedAt);
  const roots = visits.filter((visit) => !parent.has(visit.id)).sort((a, b) => a.visitedAt - b.visitedAt);
  const positions = new Map();
  const queue = roots.map((root, index) => {
    positions.set(root.id, { x: (index - (roots.length - 1) / 2) * 22, z: 0, depth: 0 });
    return root;
  });
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const ancestor = queue[cursor];
    const origin = positions.get(ancestor.id);
    const branch = children.get(ancestor.id) || [];
    branch.forEach((visit, index) => {
      positions.set(visit.id, {
        x: origin.x + (index - (branch.length - 1) / 2) * 9,
        z: origin.z - 8,
        depth: origin.depth + 1
      });
      queue.push(visit);
    });
  }
  return { byId, parent, positions };
}

// Display navigation as a 3D tree while keeping every visit selectable as a
// native keyboard button through the CSS2D overlay.
export function createJourneyGraph({ scene, onSelect }) {
  const group = new THREE.Group();
  scene.add(group);
  let nodes = [];
  let bounds = 12;
  let reducedMotion = false;

  function clear() {
    for (const object of [...group.children]) {
      group.remove(object);
      object.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((material) => material.dispose());
        }
      });
    }
    nodes = [];
  }

  function sync(snapshot = { visits: [], tabs: [], edges: [] }) {
    clear();
    const graph = graphPositions(snapshot);
    const active = new Set((snapshot.tabs || []).filter((tab) => tab.closedAt === null).map((tab) => tab.currentVisitId).filter(Boolean));
    let maxRadius = 12;
    for (const visit of graph.byId.values()) {
      const position = graph.positions.get(visit.id) || { x: 0, z: 0 };
      maxRadius = Math.max(maxRadius, Math.hypot(position.x, position.z));
      const color = COLORS[hash(domainOf(visit.url)) % COLORS.length];
      const root = new THREE.Group();
      root.position.set(position.x, 0, position.z);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color, transparent: true, opacity: active.has(visit.id) ? 0.95 : 0.65,
        depthWrite: false, blending: THREE.AdditiveBlending
      }));
      halo.scale.setScalar(active.has(visit.id) ? 3.2 : 2.4);
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }));
      core.scale.setScalar(0.75);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "journey-label" + (active.has(visit.id) ? " active" : "");
      button.innerHTML = '<span class="journey-title">' + escapeHTML(visit.title || domainOf(visit.url) || "Visited page") +
        '</span><span class="journey-domain">' + escapeHTML(domainOf(visit.url)) + "</span>";
      button.setAttribute("aria-label", `Return to ${visit.title || domainOf(visit.url) || visit.url}`);
      button.title = visit.url;
      button.addEventListener("click", () => onSelect(visit));
      const label = new CSS2DObject(button);
      label.position.set(0, 1.8, 0);
      root.add(halo, core, label);
      group.add(root);
      nodes.push({ root, halo, core, active: active.has(visit.id), phase: (hash(visit.id) % 1000) / 1000 * Math.PI * 2 });
    }

    const segments = [];
    for (const [childId, parentId] of graph.parent) {
      const from = graph.positions.get(parentId);
      const to = graph.positions.get(childId);
      if (from && to) segments.push(new THREE.Vector3(from.x, 0, from.z), new THREE.Vector3(to.x, 0, to.z));
    }
    if (segments.length) {
      const geometry = new THREE.BufferGeometry().setFromPoints(segments);
      const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x718bc9, transparent: true, opacity: 0.38 }));
      lines.renderOrder = -1;
      group.add(lines);
    }
    bounds = maxRadius;
  }

  return {
    sync,
    setVisible(visible) { group.visible = visible; },
    setReducedMotion(value) { reducedMotion = Boolean(value); },
    update(time) {
      if (reducedMotion) return;
      nodes.forEach((node) => {
        const pulse = 1 + Math.sin(time * 1.4 + node.phase) * (node.active ? 0.07 : 0.04);
        node.halo.scale.setScalar((node.active ? 3.2 : 2.4) * pulse);
        node.core.scale.setScalar(0.75 * pulse);
      });
    },
    radius: () => bounds
  };
}
