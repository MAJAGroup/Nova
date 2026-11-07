import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { escapeHTML } from "../../lib/dom.js";
import { domainOf } from "../../lib/url.js";
import { glowTexture } from "./textures.js";
import { createStarLayout } from "./star-layout.js";

const PALETTE = [0x7fdcff, 0x9aa8ff, 0xc29bff, 0xffc58a, 0xff9ccf, 0x8ff0c8];
const BASE_SIZE = 3.4;
const ACTIVE_SIZE = 4.6;
const HOVER_BOOST = 1.35;
const APPEAR_SECONDS = 0.7;
const SELECTED_BOOST = 1.2;
const GLIDE_RATE = 3;

function hash(text) {
  let value = 2166136261;
  for (const character of String(text)) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function sprite(color, opacity) {
  return new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity,
    depthWrite: false, blending: THREE.AdditiveBlending
  }));
}

// The site's icon sits on the star; the title is tucked away and slides out
// to the right while the star is hovered (see .star-label in cosmos.css).
function labelHTML(tab) {
  const domain = domainOf(tab.url);
  const mark = tab.favicon
    ? '<img src="' + escapeHTML(tab.favicon) + '" alt="">'
    : escapeHTML(domain.slice(0, 1).toUpperCase());
  return '<span class="star-label-pill">' +
    '<span class="star-label-mark">' + mark + "</span>" +
    '<span class="star-label-title">' + escapeHTML(tab.title || domain) + "</span>" +
    "</span>";
}

// One star per open tab: a coloured halo, a white-hot core and the site's
// icon, whose title shows on hover.
// Grouped tabs take their constellation's colour; others are coloured by
// site, so tabs from the same site match. Stars glide to new positions when
// tabs are grouped or ungrouped. onLayout receives each new layout so the
// constellations can follow.
export function createTabStars({ scene, camera, tabs, onSelect, onContextMenu, onLayout }) {
  const group = new THREE.Group();
  scene.add(group);
  const layout = createStarLayout();
  const stars = new Map();
  const selected = new Set();
  let hovered = null;
  let extent = 0;
  let lastTime = null;

  const activeRing = new THREE.Mesh(
    new THREE.RingGeometry(2.05, 2.13, 96),
    new THREE.MeshBasicMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
  );
  activeRing.visible = false;
  group.add(activeRing);

  function createStar(tab, position) {
    const id = String(tab.id);
    const root = new THREE.Group();
    root.position.copy(position);
    const halo = sprite(0xffffff, 1);
    const core = sprite(0xffffff, 1);
    halo.userData.tabId = id;

    const element = document.createElement("button");
    element.type = "button";
    element.className = "star-label";
    element.setAttribute("aria-label", tab.title || domainOf(tab.url));
    const label = new CSS2DObject(element);

    root.add(halo, core, label);
    group.add(root);

    const star = { id, tab, root, halo, core, label, element, target: position.clone(), labelKey: "", born: null, phase: Math.random() * Math.PI * 2 };
    element.addEventListener("click", (event) => onSelect(star.tab, event));
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      onContextMenu(star.tab);
    });
    element.addEventListener("pointerenter", () => setHovered(star));
    element.addEventListener("pointerleave", () => { if (hovered === star) setHovered(null); });
    return star;
  }

  function removeStar(star) {
    group.remove(star.root);
    star.halo.material.dispose();
    star.core.material.dispose();
    stars.delete(star.id);
    selected.delete(star.id);
    if (hovered === star) hovered = null;
  }

  function colorFor(tab) {
    const owner = tabs.groupOf(tab);
    return owner ? new THREE.Color(owner.color) : new THREE.Color(PALETTE[hash(domainOf(tab.url)) % PALETTE.length]);
  }

  function sync() {
    const next = layout.compute(tabs.tabs, tabs.groups);
    extent = next.extent;
    for (const star of Array.from(stars.values())) if (!next.stars.has(star.id)) removeStar(star);
    for (const tab of tabs.tabs) {
      const id = String(tab.id);
      const target = next.stars.get(id);
      const star = stars.get(id) || createStar(tab, target);
      stars.set(id, star);
      star.tab = tab;
      star.target.copy(target);
      const color = colorFor(tab);
      star.halo.material.color.copy(color);
      star.element.style.setProperty("--star-color", "#" + color.getHexString());
      const owner = tabs.groupOf(tab);
      const key = [tab.title, tab.url, tab.favicon, owner ? owner.color : ""].join("\n");
      if (key !== star.labelKey) {
        star.labelKey = key;
        star.element.innerHTML = labelHTML(tab);
        star.element.setAttribute("aria-label", tab.title || domainOf(tab.url));
        star.element.title = (owner ? owner.name + " · " : "") + (tab.url || "");
        star.element.style.setProperty("--group-color", owner ? owner.color : "");
      }
      star.element.classList.toggle("grouped", Boolean(owner));
      star.element.classList.toggle("active", tabs.isActive(tab));
      star.element.classList.toggle("selected", selected.has(id));
    }
    onLayout(next);
  }

  function setHovered(star) {
    if (hovered) hovered.element.classList.remove("hovered");
    hovered = star;
    if (hovered) hovered.element.classList.add("hovered");
  }

  function setSelected(id, isSelected) {
    if (isSelected) selected.add(id);
    else selected.delete(id);
    const star = stars.get(id);
    if (star) star.element.classList.toggle("selected", isSelected);
  }

  tabs.subscribe(sync);

  return {
    update(time) {
      const delta = lastTime === null ? 0 : Math.min(0.1, time - lastTime);
      lastTime = time;
      const glide = 1 - Math.exp(-delta * GLIDE_RATE);
      let active = null;
      for (const star of stars.values()) {
        star.root.position.lerp(star.target, glide);
        if (star.born === null) star.born = time;
        const grow = Math.min(1, (time - star.born) / APPEAR_SECONDS);
        const eased = 1 - Math.pow(1 - grow, 3);
        const isActive = tabs.isActive(star.tab);
        if (isActive) active = star;
        let size = isActive ? ACTIVE_SIZE : BASE_SIZE;
        if (star === hovered) size *= HOVER_BOOST;
        if (selected.has(star.id)) size *= SELECTED_BOOST;
        size *= 1 + Math.sin(time * 1.7 + star.phase) * 0.07;
        star.halo.scale.setScalar(size * eased);
        star.core.scale.setScalar(size * 0.35 * eased);
        star.halo.material.opacity = eased;
        star.core.material.opacity = eased;
      }
      activeRing.visible = Boolean(active);
      if (active) {
        activeRing.position.copy(active.root.position);
        activeRing.quaternion.copy(camera.quaternion);
        activeRing.scale.setScalar(1 + Math.sin(time * 2.2) * 0.06);
      }
    },
    pick(raycaster) {
      const hit = raycaster.intersectObjects(Array.from(stars.values(), (star) => star.halo))[0];
      return hit ? stars.get(hit.object.userData.tabId) : null;
    },
    positionOf: (id) => (stars.has(id) ? stars.get(id).root.position : null),
    toggleSelected(id) {
      setSelected(String(id), !selected.has(String(id)));
      return selected.size;
    },
    selectedIds: () => Array.from(selected),
    clearSelection() {
      const had = selected.size > 0;
      for (const id of Array.from(selected)) setSelected(id, false);
      return had;
    },
    setHovered,
    extent: () => extent
  };
}
