import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { escapeHTML } from "../../lib/dom.js";
import { domainOf } from "../../lib/url.js";
import { glowTexture } from "./textures.js";
import { createStarLayout } from "./star-layout.js";

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
const PALETTE = [0x7fdcff, 0x9aa8ff, 0xc29bff, 0xffc58a, 0xff9ccf, 0x8ff0c8];
const BASE_SIZE = 3.4;
const ACTIVE_SIZE = 4.6;
const HOVER_BOOST = 1.35;
const APPEAR_SECONDS = 0.7;
const BIRTH_SECONDS = 1.65;
const BIRTH_TRAIL_SEGMENTS = 30;
const SELECTED_BOOST = 1.2;
const GLIDE_RATE = 3;
// Tab icons grow as the camera comes closer, so zooming in on a cluster
// makes its tabs bigger targets: scale = LABEL_REFERENCE / distance, clamped.
const LABEL_REFERENCE = 26;
const LABEL_MIN = 0.85;
const LABEL_MAX = 2.4;
const FALL_SECONDS = 1.4;
const TAIL_SPRITES = 26;
const TAIL_SPACING = 0.014;

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
//
// A new tab ignites at the black-hole core and follows a glowing spiral into
// its orbit while the cosmos is visible.
// A closed tab spirals into the black hole while the cosmos is visible.
export function createTabStars({ scene, camera, tabs, sink, isVisible, birthSource, onSelect, onPress, onContextMenu, onLayout, layout = createStarLayout(), reducedMotion = () => REDUCED_MOTION.matches, emphasisFor = () => 1, animateLayout = true }) {
  const group = new THREE.Group();
  scene.add(group);
  const stars = new Map();
  const selected = new Set();
  const falling = new Set();
  let hovered = null;
  let extent = 0;
  let lastTime = null;

  const activeRing = new THREE.Mesh(
    new THREE.RingGeometry(2.05, 2.13, 96),
    new THREE.MeshBasicMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
  );
  activeRing.visible = false;
  group.add(activeRing);

  function birthPoint(birth, progress, target = new THREE.Vector3()) {
    const t = THREE.MathUtils.clamp(progress, 0, 1), inverse = 1 - t;
    target.copy(birth.from).multiplyScalar(inverse * inverse)
      .addScaledVector(birth.control, 2 * inverse * t)
      .addScaledVector(birth.to, t * t);
    const swirl = Math.sin(Math.PI * t) * (1 - t) * birth.spiral;
    const angle = birth.phase + t * Math.PI * 4.5;
    target.x += Math.cos(angle) * swirl;
    target.y += Math.sin(angle) * swirl * 0.55;
    target.z += Math.sin(angle + 0.8) * swirl;
    return target;
  }

  function createBirthEffect(from, to, color) {
    const direction = to.clone().sub(from);
    const distance = direction.length();
    if (distance > 0.001) direction.normalize();
    const side = new THREE.Vector3(-direction.z, 0.55, direction.x);
    if (side.lengthSq() < 0.001) side.set(1, 0, 0);
    side.normalize();
    const control = from.clone().lerp(to, 0.54).addScaledVector(side, Math.min(6, Math.max(1.2, distance * 0.24)));

    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array((BIRTH_TRAIL_SEGMENTS + 1) * 3), 3));
    const trailMaterial = new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false
    });
    const trail = new THREE.Line(trailGeometry, trailMaterial);
    trail.frustumCulled = false;
    trail.renderOrder = 10;
    group.add(trail);

    const flare = sprite(color, 0);
    flare.material.depthTest = false;
    flare.renderOrder = 12;
    group.add(flare);

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 64), new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, side: THREE.DoubleSide,
      depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
    }));
    ring.renderOrder = 11;
    group.add(ring);

    return {
      start: null, duration: BIRTH_SECONDS, from: from.clone(), to: to.clone(), control,
      spiral: Math.min(1.8, Math.max(0.45, distance * 0.09)), phase: Math.random() * Math.PI * 2,
      trail, flare, ring, sample: new THREE.Vector3()
    };
  }

  function disposeBirthEffect(birth) {
    if (!birth) return;
    group.remove(birth.trail, birth.flare, birth.ring);
    birth.trail.geometry.dispose();
    birth.trail.material.dispose();
    birth.flare.material.dispose();
    birth.ring.geometry.dispose();
    birth.ring.material.dispose();
  }

  function completeBirth(star, time) {
    if (!star.birth) return;
    disposeBirthEffect(star.birth);
    star.birth = null;
    star.root.position.copy(star.target);
    star.element.classList.remove("star-born");
    star.born = time - APPEAR_SECONDS;
  }

  function updateBirth(star, time) {
    const birth = star.birth;
    if (birth.start === null) birth.start = time;
    const progress = reducedMotion() ? 1 : Math.min(1, (time - birth.start) / birth.duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    birth.to.copy(star.target);
    star.root.position.copy(birthPoint(birth, progress, birth.sample));

    const samples = Math.max(2, Math.ceil(progress * BIRTH_TRAIL_SEGMENTS));
    const positions = birth.trail.geometry.attributes.position;
    for (let index = 0; index <= samples; index++) {
      const point = birthPoint(birth, progress * index / samples, birth.sample);
      positions.setXYZ(index, point.x, point.y, point.z);
    }
    positions.needsUpdate = true;
    birth.trail.geometry.setDrawRange(0, samples + 1);
    birth.trail.geometry.computeBoundingSphere();
    birth.trail.material.opacity = 0.92 * Math.pow(1 - progress, 0.7);

    birth.flare.position.copy(birth.from);
    birth.flare.scale.setScalar(1.8 + eased * 11);
    birth.flare.material.opacity = 1.15 * Math.pow(1 - progress, 1.65);
    birth.ring.position.copy(birth.from);
    birth.ring.quaternion.copy(camera.quaternion);
    birth.ring.scale.setScalar(1 + eased * 12);
    birth.ring.material.opacity = 0.82 * Math.pow(1 - progress, 1.8);

    if (progress >= 1) completeBirth(star, time);
    return eased;
  }

  function createStar(tab, position) {
    const id = String(tab.id);
    const root = new THREE.Group();
    let origin = null;
    if (birthSource && (!isVisible || isVisible()) && !reducedMotion()) {
      const source = typeof birthSource === "function" ? birthSource(tab, position) : birthSource;
      if (source && source.isVector3) origin = source.clone();
    }
    root.position.copy(origin || position);
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

    const birth = origin ? createBirthEffect(origin, position, colorFor(tab)) : null;
    const star = { id, tab, root, halo, core, label, element, target: position.clone(), labelKey: "", labelScale: 1, born: null, birth, phase: Math.random() * Math.PI * 2 };
    if (birth) {
      element.classList.add("star-born");
      if (sink && sink.feed) sink.feed(0.65);
    }
    element.addEventListener("click", (event) => onSelect(star.tab, event));
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      onContextMenu(star.tab);
    });
    element.addEventListener("pointerdown", (event) => { if (onPress) onPress(star, event); });
    element.addEventListener("pointerenter", () => setHovered(star));
    element.addEventListener("pointerleave", () => { if (hovered === star) setHovered(null); });
    return star;
  }

  function detach(star) {
    stars.delete(star.id);
    selected.delete(star.id);
    if (hovered === star) setHovered(null);
  }

  // Removing the star's group from the scene doesn't take its label's HTML
  // element out of the label layer (CSS2DObject only cleans up when it is
  // removed itself), so that has to go explicitly.
  function disposeStar(star) {
    star.label.removeFromParent();
    group.remove(star.root);
    star.element.remove();
    star.halo.material.dispose();
    star.core.material.dispose();
    disposeBirthEffect(star.birth);
    star.birth = null;
    if (star.fall) {
      for (const piece of star.fall.tail) {
        group.remove(piece);
        piece.material.dispose();
      }
    }
    falling.delete(star);
  }

  function removeStar(star) {
    detach(star);
    if (star.birth) {
      disposeBirthEffect(star.birth);
      star.birth = null;
      star.element.classList.remove("star-born");
    }
    if (!sink || !isVisible || !isVisible() || reducedMotion()) {
      disposeStar(star);
      return;
    }
    // Hand the star over to the black hole.
    const position = star.root.position;
    const radius = Math.max(sink.radius * 3, Math.hypot(position.x, position.z));
    const color = star.halo.material.color.clone();
    const tail = [];
    for (let i = 0; i < TAIL_SPRITES; i++) {
      const piece = sprite(color, 0);
      piece.position.copy(position);
      group.add(piece);
      tail.push(piece);
    }
    star.fall = {
      start: null,
      duration: Math.min(2.1, FALL_SECONDS + radius * 0.015),
      radius,
      angle: Math.atan2(position.z, position.x),
      height: position.y,
      size: tabs.isActive(star.tab) ? ACTIVE_SIZE : BASE_SIZE,
      color,
      tail
    };
    star.element.classList.remove("hovered", "selected");
    star.element.classList.add("falling");
    falling.add(star);
  }

  const hot = new THREE.Color(0xffd9a8);
  const screenA = new THREE.Vector3();
  const screenB = new THREE.Vector3();
  const tint = new THREE.Color();

  // Where a falling star is at a given point of its fall (0..1). The radius
  // closes slowly, then plunges; the angle follows sqrt(r0 / r), so the star
  // whips round faster the closer it gets, like gas in the disk. It sinks
  // onto the disk plane as it goes.
  function fallPoint(fall, progress, out) {
    const t = Math.max(0, progress);
    const end = sink.radius * 1.15;
    const radius = end + (fall.radius - end) * (1 - Math.pow(t, 1.6));
    const angle = fall.angle + 1.25 * (Math.sqrt(fall.radius / radius) - 1);
    const height = fall.height * Math.pow((radius - end) / (fall.radius - end), 1.5);
    out.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    return 1 - (radius - end) / (fall.radius - end);
  }

  function updateFalling(star, time) {
    const fall = star.fall;
    if (fall.start === null) fall.start = time;
    const progress = Math.min(1, (time - fall.start) / fall.duration);
    const closeness = fallPoint(fall, progress, star.root.position);
    const fade = 1 - THREE.MathUtils.smoothstep(progress, 0.86, 1);

    // The star shrinks and heats up, and only near the end stretches along
    // its path.
    fallPoint(fall, progress - 0.02, screenA);
    screenA.project(camera);
    screenB.copy(star.root.position).project(camera);
    const rotation = Math.atan2(screenB.y - screenA.y, (screenB.x - screenA.x) * camera.aspect);
    const stretch = 1 + 2.2 * Math.pow(closeness, 3);
    const size = fall.size * (1 - 0.7 * closeness);
    tint.copy(fall.color).lerp(hot, Math.min(1, closeness * 1.4));
    star.halo.material.color.copy(tint);
    star.halo.scale.set(size * stretch, size / Math.sqrt(stretch), 1);
    star.core.scale.set(size * 0.4 * stretch, size * 0.4 / Math.sqrt(stretch), 1);
    for (const piece of [star.halo, star.core]) {
      piece.material.rotation = rotation;
      piece.material.opacity = fade;
    }

    // A comet tail traced along the path just behind the star.
    fall.tail.forEach((piece, index) => {
      const back = (index + 1) * TAIL_SPACING;
      fallPoint(fall, progress - back, piece.position);
      const along = 1 - index / TAIL_SPRITES;
      const grown = Math.min(1, progress / back);
      piece.material.color.copy(tint);
      piece.material.opacity = 0.55 * along * along * grown * fade;
      piece.scale.setScalar(size * 0.6 * along);
    });

    // The icon shrinks into the glow before the star reaches the horizon.
    const iconScale = Math.max(0, 1 - closeness * 1.15);
    const pill = star.element.firstElementChild;
    if (pill) pill.style.transform = "scale(" + star.labelScale.toFixed(3) + ") translate(12px, 12px) scale(" + iconScale.toFixed(3) + ") translate(-12px, -12px)";
    star.element.style.opacity = (1 - THREE.MathUtils.smoothstep(closeness, 0.55, 0.85)).toFixed(3);

    if (progress >= 1) {
      sink.feed(tabs.isActive(star.tab) ? 1.3 : 1);
      disposeStar(star);
    }
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
      if (star.birth) star.birth.to.copy(target);
      const color = colorFor(tab);
      star.halo.material.color.copy(color);
      if (star.birth) {
        star.birth.trail.material.color.copy(color);
        star.birth.flare.material.color.copy(color);
        star.birth.ring.material.color.copy(color);
      }
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
      const glide = !animateLayout || reducedMotion() ? 1 : 1 - Math.exp(-delta * GLIDE_RATE);
      let active = null;
      for (const star of Array.from(falling)) updateFalling(star, time);
      for (const star of stars.values()) {
        let eased;
        if (star.birth) eased = updateBirth(star, time);
        else {
          if (!star.held) star.root.position.lerp(star.target, glide);
          if (star.born === null) star.born = time;
          const grow = reducedMotion() ? 1 : Math.min(1, (time - star.born) / APPEAR_SECONDS);
          eased = 1 - Math.pow(1 - grow, 3);
        }
        const isActive = tabs.isActive(star.tab);
        if (isActive) active = star;
        let size = isActive ? ACTIVE_SIZE : BASE_SIZE;
        if (star === hovered) size *= HOVER_BOOST;
        if (selected.has(star.id)) size *= SELECTED_BOOST;
        // Shrinks smoothly while dragged over the black hole.
        star.doom = (star.doom || 0) + ((star.doomed ? 1 : 0) - (star.doom || 0)) * Math.min(1, delta * 8);
        size *= 1 - 0.55 * star.doom;
        if (!reducedMotion()) size *= 1 + Math.sin(time * 1.7 + star.phase) * 0.07;
        star.halo.scale.setScalar(size * eased);
        const labelScale = THREE.MathUtils.clamp(LABEL_REFERENCE / camera.position.distanceTo(star.root.position), LABEL_MIN, LABEL_MAX);
        if (Math.abs(labelScale - star.labelScale) > 0.01) {
          star.labelScale = labelScale;
          star.element.style.setProperty("--label-scale", labelScale.toFixed(3));
        }
        star.core.scale.setScalar(size * 0.35 * eased);
        const emphasis = emphasisFor(star.tab);
        star.halo.material.opacity = eased * emphasis;
        star.core.material.opacity = eased * emphasis;
        star.element.style.opacity = String(emphasis);
        star.element.classList.toggle("subdued", emphasis < .99);
      }
      activeRing.visible = Boolean(active);
      if (active) {
        activeRing.position.copy(active.root.position);
        activeRing.quaternion.copy(camera.quaternion);
        activeRing.scale.setScalar(reducedMotion() ? 1 : 1 + Math.sin(time * 2.2) * 0.06);
      }
    },
    pick(raycaster) {
      const hit = raycaster.intersectObjects(Array.from(stars.values(), (star) => star.halo))[0];
      return hit ? stars.get(hit.object.userData.tabId) : null;
    },
    // While held (being dragged, or dropped on the black hole and waiting
    // for the tab to close) a star stays where it is put instead of gliding
    // back to its place.
    grab(star) {
      star.held = true;
      clearTimeout(star.holdTimer);
      setHovered(null);
      star.element.classList.add("dragging");
    },
    release(star, { stay = false } = {}) {
      star.element.classList.remove("dragging", "doomed", "joining");
      star.doomed = false;
      clearTimeout(star.holdTimer);
      if (stay) star.holdTimer = setTimeout(() => { star.held = false; }, 2000);
      else star.held = false;
    },
    // Marks the star with the colour of the constellation it would join.
    setJoining(star, color) {
      star.element.classList.toggle("joining", Boolean(color));
      if (color) star.element.style.setProperty("--join-color", color);
    },
    setDoomed(star, doomed) {
      star.doomed = doomed;
      star.element.classList.toggle("doomed", doomed);
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
    // Ends any infall still playing, e.g. when the cosmos is hidden.
    finishFalling() {
      for (const star of Array.from(falling)) disposeStar(star);
    },
    finishBirths() {
      for (const star of stars.values()) if (star.birth) completeBirth(star, lastTime ?? 0);
    },
    extent: () => extent
  };
}
