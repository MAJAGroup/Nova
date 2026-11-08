export function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function dateLabel(key) {
  const date = new Date(key + "T12:00:00");
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const prefix = key === dateKey(today) ? "Today · " : key === dateKey(yesterday) ? "Yesterday · " : "";
  return prefix + date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
export const clock = value => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const COLORS = ["#8fe0ef", "#b5a6ef", "#efc28f", "#93d8bd", "#e7abc4"];
const chronological = (a, b) => a.at - b.at || a.id.localeCompare(b.id);

function colorFor(id) {
  let hash = 2166136261;
  for (const c of id) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return COLORS[(hash >>> 0) % COLORS.length];
}

// Resolve against the complete retained graph: filtering a date or a title
// must not split a journey or invent an edge across a hidden intermediate visit.
export function historyLayout(visits, allVisits = visits) {
  const byId = new Map(allVisits.map(v => [v.id, v]));
  const roots = new Map();
  function rootOf(visit) {
    const path = [], seen = new Set();
    let current = visit;
    while (!roots.has(current.id) && current.parent && byId.has(current.parent) && !seen.has(current.id)) {
      seen.add(current.id); path.push(current.id); current = byId.get(current.parent);
    }
    // A malformed imported cycle still has one stable constellation.
    const root = roots.get(current.id) || (seen.has(current.id) ? [...seen].sort()[0] : current.id);
    roots.set(current.id, root);
    for (const id of path) roots.set(id, root);
    return root;
  }
  const members = new Map();
  for (const visit of [...visits].sort(chronological)) {
    const root = rootOf(visit);
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(visit);
  }
  const positions = new Map(), groupOf = new Map(), groups = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (const [id, list] of members) {
    const origin = byId.get(id) || list[0];
    let domain = origin.url || "Browsing journey";
    try { domain = new URL(origin.url).hostname; } catch { /* historical metadata may be incomplete */ }
    const radius = list.length === 1 ? 4 : 4 + 3.4 * Math.sqrt(list.length - 1);
    const ids = new Set(list.map(v => v.id));
    const edges = list.filter(v => ids.has(v.parent)).map(v => [v.parent, v.id]);
    groups.push({ id, name: origin.title || domain, color: colorFor(id), radius,
      at: origin.at, memberIds: list.map(v => v.id), edges, center: { x: 0, y: 0, z: 0 } });
    list.forEach((visit, index) => {
      const distance = index === 0 ? 0 : 4 + 3.4 * Math.sqrt(index);
      positions.set(visit.id, { x: Math.cos(index * golden) * distance,
        y: Math.sin(index * 2.3 + .8) * Math.min(4, distance * .2), z: Math.sin(index * golden) * distance });
      groupOf.set(visit.id, id);
    });
  }
  // Pack navigation constellations into a compact atlas, rather than date lanes.
  const width = Math.sqrt(groups.reduce((sum, g) => sum + (g.radius * 2 + 16) ** 2, 0)) * 1.6;
  let x = 0, z = 0, rowDepth = 0;
  for (const [index, group] of groups.entries()) {
    const size = group.radius * 2 + 16;
    if (x && x + size > width) { x = 0; z += rowDepth; rowDepth = 0; }
    group.center = { x: x + size / 2, y: Math.sin(index * 1.8) * 3, z: z + size / 2 };
    x += size; rowDepth = Math.max(rowDepth, size);
  }
  const offsetX = groups.length ? (Math.min(...groups.map(g => g.center.x - g.radius)) + Math.max(...groups.map(g => g.center.x + g.radius))) / 2 : 0;
  const offsetZ = groups.length ? (Math.min(...groups.map(g => g.center.z - g.radius)) + Math.max(...groups.map(g => g.center.z + g.radius))) / 2 : 0;
  for (const group of groups) {
    group.center.x -= offsetX; group.center.z -= offsetZ;
    for (const id of group.memberIds) {
      const p = positions.get(id);
      p.x += group.center.x; p.y += group.center.y; p.z += group.center.z;
    }
  }
  return { positions, groups, groupOf };
}
