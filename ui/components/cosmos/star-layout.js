import * as THREE from "three";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Position of the nth slot: a loose spiral disc, like a galaxy, with each
// star lifted a little above or below the plane so the cosmos has depth.
function slotPosition(index) {
  const radius = 6 + 4.6 * Math.sqrt(index);
  const angle = index * GOLDEN_ANGLE;
  const lift = Math.sin(index * 2.1) * Math.min(6, 1.5 + radius * 0.22);
  return new THREE.Vector3(Math.cos(angle) * radius, lift, Math.sin(angle) * radius);
}

// Gives each tab a slot that stays put while the tab is open, so stars don't
// jump around when other tabs open or close. Freed slots are reused.
export function createStarLayout() {
  const slots = new Map();

  return {
    take(id) {
      if (!slots.has(id)) {
        const used = new Set(slots.values());
        let index = 0;
        while (used.has(index)) index++;
        slots.set(id, index);
      }
      return slotPosition(slots.get(id));
    },
    release(id) {
      slots.delete(id);
    },
    radius() {
      let max = 0;
      for (const index of slots.values()) max = Math.max(max, slotPosition(index).length());
      return max;
    }
  };
}
