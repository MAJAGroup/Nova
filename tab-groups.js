"use strict";

// Tab groups ("constellations"). Tabs point at a group by id; a group with
// no tabs left is removed by prune().

const NAMES = [
  "Orion", "Lyra", "Cygnus", "Draco", "Andromeda", "Perseus", "Cassiopeia",
  "Pegasus", "Aquila", "Phoenix", "Vela", "Carina", "Hydra", "Corvus"
];
const COLORS = ["#7fdcff", "#c29bff", "#ffc58a", "#ff9ccf", "#8ff0c8", "#9aa8ff", "#ffe27a"];
const MAX_NAME_LENGTH = 40;

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

function createTabGroups() {
  const groups = new Map();
  let nextId = 1;

  function unusedName() {
    const used = new Set(Array.from(groups.values(), (group) => group.name));
    return NAMES.find((name) => !used.has(name)) || "Constellation " + nextId;
  }

  function leastUsedColor() {
    const counts = new Map(COLORS.map((color) => [color, 0]));
    for (const group of groups.values()) counts.set(group.color, (counts.get(group.color) || 0) + 1);
    return COLORS.reduce((best, color) => (counts.get(color) < counts.get(best) ? color : best));
  }

  return {
    list: () => Array.from(groups.values(), (group) => ({ ...group })),
    get: (id) => groups.get(String(id)) || null,
    create(name) {
      const id = String(nextId++);
      groups.set(id, { id, name: cleanName(name) || unusedName(), color: leastUsedColor() });
      return id;
    },
    rename(id, name) {
      const group = groups.get(String(id));
      const cleaned = cleanName(name);
      if (!group || !cleaned) return false;
      group.name = cleaned;
      return true;
    },
    // Drops groups that no open tab belongs to.
    prune(tabs) {
      const used = new Set();
      for (const tab of tabs.values()) if (tab.groupId) used.add(tab.groupId);
      for (const id of Array.from(groups.keys())) if (!used.has(id)) groups.delete(id);
    }
  };
}

module.exports = { createTabGroups };
