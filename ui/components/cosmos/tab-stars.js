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

function labelHTML(tab) {
  const domain = domainOf(tab.url);
  const mark = tab.favicon
    ? '<img src="' + escapeHTML(tab.favicon) + '" alt="">'
    : escapeHTML(domain.slice(0, 1).toUpperCase());
  return '<span class="star-label-mark">' + mark + "</span>" +
    '<span class="star-label-title">' + escapeHTML(tab.title || domain) + "</span>" +
    '<span class="star-label-domain">' + escapeHTML(domain) + "</span>";
}

// One star per open tab: a coloured halo, a white-hot core and an HTML label.
// Colour comes from the site, so tabs from the same site share a colour.
export function createTabStars({ scene, camera, tabs, onSelect }) {
  const group = new THREE.Group();
  scene.add(group);
  const layout = createStarLayout();
  const stars = new Map();
  let hovered = null;
  let reducedMotion = false;

  const activeRing = new THREE.Mesh(
    new THREE.RingGeometry(2.05, 2.13, 96),
    new THREE.MeshBasicMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
  );
  activeRing.visible = false;
  group.add(activeRing);

  function createStar(tab) {
    const id = String(tab.id);
    const root = new THREE.Group();
    root.position.copy(layout.take(id));
    const halo = sprite(PALETTE[hash(domainOf(tab.url)) % PALETTE.length], 1);
    const core = sprite(0xffffff, 1);
    halo.userData.tabId = id;

    const element = document.createElement("button");
    element.type = "button";
    element.className = "star-label";
    const label = new CSS2DObject(element);
    label.position.set(0, -2.3, 0);

    root.add(halo, core, label);
    group.add(root);

    const star = { id, tab, root, halo, core, element, labelKey: "", born: null, phase: Math.random() * Math.PI * 2 };
    element.addEventListener("click", () => onSelect(star.tab));
    element.addEventListener("pointerenter", () => setHovered(star));
    element.addEventListener("pointerleave", () => { if (hovered === star) setHovered(null); });
    return star;
  }

  function removeStar(star) {
    group.remove(star.root);
    star.halo.material.dispose();
    star.core.material.dispose();
    layout.release(star.id);
    stars.delete(star.id);
    if (hovered === star) hovered = null;
  }

  function sync() {
    const open = new Set(tabs.tabs.map((tab) => String(tab.id)));
    for (const star of [...stars.values()]) if (!open.has(star.id)) removeStar(star);
    for (const tab of tabs.tabs) {
      const id = String(tab.id);
      const star = stars.get(id) || createStar(tab);
      stars.set(id, star);
      star.tab = tab;
      star.halo.material.color.setHex(PALETTE[hash(domainOf(tab.url)) % PALETTE.length]);
      const key = [tab.title, tab.url, tab.favicon].join("\n");
      if (key !== star.labelKey) {
        star.labelKey = key;
        star.element.innerHTML = labelHTML(tab);
        star.element.title = tab.url || "";
      }
      star.element.classList.toggle("active", tabs.isActive(tab));
    }
  }

  function setHovered(star) {
    if (hovered) hovered.element.classList.remove("hovered");
    hovered = star;
    if (hovered) hovered.element.classList.add("hovered");
  }

  tabs.subscribe(sync);

  return {
    setVisible(visible) { group.visible = visible; },
    update(time) {
      let active = null;
      for (const star of stars.values()) {
        if (star.born === null) star.born = time;
        const grow = reducedMotion ? 1 : Math.min(1, (time - star.born) / APPEAR_SECONDS);
        const eased = 1 - Math.pow(1 - grow, 3);
        const isActive = tabs.isActive(star.tab);
        if (isActive) active = star;
        let size = isActive ? ACTIVE_SIZE : BASE_SIZE;
        if (star === hovered) size *= HOVER_BOOST;
        if (!reducedMotion) size *= 1 + Math.sin(time * 1.7 + star.phase) * 0.07;
        star.halo.scale.setScalar(size * eased);
        star.core.scale.setScalar(size * 0.35 * eased);
        star.halo.material.opacity = eased;
        star.core.material.opacity = eased;
      }
      activeRing.visible = Boolean(active);
      if (active) {
        activeRing.position.copy(active.root.position);
        activeRing.quaternion.copy(camera.quaternion);
        activeRing.scale.setScalar(reducedMotion ? 1 : 1 + Math.sin(time * 2.2) * 0.06);
      }
    },
    setReducedMotion(value) { reducedMotion = Boolean(value); },
    pick(raycaster) {
      const hit = raycaster.intersectObjects([...stars.values()].map((star) => star.halo))[0];
      return hit ? stars.get(hit.object.userData.tabId) : null;
    },
    setHovered,
    radius: () => layout.radius()
  };
}
