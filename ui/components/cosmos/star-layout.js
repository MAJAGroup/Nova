import * as THREE from "three";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const GROUP_GAP = 3.5;

function hashUnit(text) {
  let value = 2166136261;
  for (const character of String(text)) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0) / 4294967296;
}

// Ungrouped tabs: a loose spiral disc around the black hole, each star lifted a
// little above or below the plane so the cosmos has depth.
function looseSlot(index) {
  const radius = 4.5 + 3.3 * Math.sqrt(index);
  const angle = index * GOLDEN_ANGLE;
  const lift = Math.sin(index * 2.1) * Math.min(4, 1 + radius * 0.15);
  return new THREE.Vector3(Math.cos(angle) * radius, lift, Math.sin(angle) * radius);
}

// A member's offset from its constellation's centre. It depends only on the
// member's index, so adding a tab never moves the stars already there; the
// seed turns each constellation so they don't all share one shape.
function memberOffset(index, seed) {
  const radius = 1.6 + 2.2 * Math.sqrt(index);
  const angle = index * GOLDEN_ANGLE + seed * Math.PI * 2;
  const lift = Math.sin(index * 2.3 + seed * 6) * 0.9;
  return new THREE.Vector3(Math.cos(angle) * radius, lift, Math.sin(angle) * radius);
}

function clusterRadius(count) {
  return 1.6 + 2.2 * Math.sqrt(Math.max(0, count - 1));
}

// Hands out the lowest free slot number per id and keeps it while the id stays.
function createSlots() {
  const slots = new Map();
  return {
    keep(ids) {
      for (const id of Array.from(slots.keys())) if (!ids.has(id)) slots.delete(id);
    },
    take(id) {
      if (!slots.has(id)) {
        const used = new Set(slots.values());
        let index = 0;
        while (used.has(index)) index++;
        slots.set(id, index);
      }
      return slots.get(id);
    }
  };
}

// Works out where every tab's star belongs. Ungrouped tabs fill the inner
// disc; each group becomes a constellation in its own region outside it.
// Slots stick to tab and group ids so things don't jump around.
export function createStarLayout() {
  const looseSlots = createSlots();
  const groupSlots = createSlots();

  return {
    compute(tabs, groups) {
      const groupIds = new Set(groups.map((group) => group.id));
      const members = new Map(groups.map((group) => [group.id, []]));
      const loose = [];
      for (const tab of tabs) {
        if (tab.groupId && groupIds.has(tab.groupId)) members.get(tab.groupId).push(tab);
        else loose.push(tab);
      }
      const active = groups.filter((group) => members.get(group.id).length);
      looseSlots.keep(new Set(loose.map((tab) => String(tab.id))));
      groupSlots.keep(new Set(active.map((group) => group.id)));

      const stars = new Map();
      let looseExtent = 0;
      for (const tab of loose) {
        const position = looseSlot(looseSlots.take(String(tab.id)));
        stars.set(String(tab.id), position);
        looseExtent = Math.max(looseExtent, Math.hypot(position.x, position.z));
      }

      const largest = Math.max(0, ...active.map((group) => clusterRadius(members.get(group.id).length)));
      const ringStart = looseExtent + largest + GROUP_GAP;
      const constellations = new Map();
      let extent = looseExtent;

      for (const group of active) {
        const slot = groupSlots.take(group.id);
        const angle = slot * GOLDEN_ANGLE + 0.6;
        const distance = ringStart + (largest + GROUP_GAP) * Math.sqrt(slot);
        const center = new THREE.Vector3(Math.cos(angle) * distance, Math.sin(slot * 1.3) * 3, Math.sin(angle) * distance);
        const seed = hashUnit(group.id);
        const list = members.get(group.id);
        list.forEach((tab, index) => stars.set(String(tab.id), center.clone().add(memberOffset(index, seed))));
        const radius = clusterRadius(list.length);
        constellations.set(group.id, { center, radius, memberIds: list.map((tab) => String(tab.id)) });
        extent = Math.max(extent, distance + radius);
      }

      return { stars, constellations, extent };
    }
  };
}
