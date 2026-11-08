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

// Matching visits form ordered trees in their own horizontal bands. Full
// history determines journey identity, while only results occupy layout slots.
// Hidden intermediate visits never introduce a fabricated connection.
export function historyLayout(visits, allVisits = visits) {
  const sorted = [...visits].sort(chronological);
  const byId = new Map(allVisits.map(v => [v.id, v])), roots = new Map();
  function rootOf(visit) {
    const path = [], seen = new Set(); let current = visit;
    while (!roots.has(current.id) && current.parent && byId.has(current.parent) && !seen.has(current.id)) {
      seen.add(current.id); path.push(current.id); current = byId.get(current.parent);
    }
    const root = roots.get(current.id) || (seen.has(current.id) ? [...seen].sort()[0] : current.id);
    roots.set(current.id, root); for (const id of path) roots.set(id, root);
    return root;
  }
  const allGroups = new Map(), timeX = new Map(), dayRanges = [];
  let cursor = 0, currentDay;
  for (const visit of sorted) {
    const key = dateKey(visit.at);
    if (key !== currentDay) {
      if (currentDay) cursor += 22;
      dayRanges.push({ id: key, name: dateLabel(key), start: cursor, end: cursor }); currentDay = key;
    }
    timeX.set(visit.id, cursor); dayRanges.at(-1).end = cursor; cursor += 10;
    const id = rootOf(visit);
    if (!allGroups.has(id)) allGroups.set(id, []);
    allGroups.get(id).push(visit);
  }
  const wanted = new Set(visits.map(v => v.id));
  const positions = new Map(), groupOf = new Map(), groups = [];
  let row = 0;
  for (const [id, members] of allGroups) {
    const visible = members.filter(v => wanted.has(v.id)); if (!visible.length) continue;
    const children = new Map(members.map(v => [v.id, []]));
    for (const v of members) if (v.id !== id && children.has(v.parent)) children.get(v.parent).push(v.id);
    const forestRoots = members.filter(v => v.id === id || !children.has(v.parent)).map(v => v.id);
    if (!forestRoots.length) forestRoots.push(members[0].id);
    const placed = new Map(), seen = new Set(), stack = forestRoots.slice().reverse().map(id => [id, false]);
    let leaf = 0;
    while (stack.length) {
      const [node, exiting] = stack.pop();
      if (exiting) {
        const kids = children.get(node).filter(child => placed.has(child));
        const y = kids.length ? (placed.get(kids[0]).y + placed.get(kids.at(-1)).y) / 2 : leaf++ * 12;
        placed.set(node, { x: timeX.get(node), y, z: 0 });
      } else if (!seen.has(node)) {
        seen.add(node); stack.push([node, true]);
        for (const child of [...(children.get(node) || [])].reverse()) stack.push([child, false]);
      }
    }
    // A retained/corrupt fragment must stay finite rather than disappear.
    for (const v of members) if (!placed.has(v.id)) placed.set(v.id, { x: timeX.get(v.id), y: leaf++ * 12, z: 0 });
    // Protect routing from clock corrections or malformed imported timestamps.
    const pending = [...forestRoots], ordered = new Set();
    while (pending.length) {
      const parent = pending.pop(); if (ordered.has(parent)) continue; ordered.add(parent);
      for (const child of children.get(parent) || []) {
        placed.get(child).x = Math.max(placed.get(child).x, placed.get(parent).x + 10); pending.push(child);
      }
    }
    const minLocalY = Math.min(...visible.map(v => placed.get(v.id).y));
    const maxLocalY = Math.max(...visible.map(v => placed.get(v.id).y));
    for (const v of visible) {
      const p = placed.get(v.id); positions.set(v.id, { x: p.x, y: row + maxLocalY - p.y, z: 0 }); groupOf.set(v.id, id);
    }
    const points = visible.map(v => positions.get(v.id));
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
    const height = maxLocalY - minLocalY;
    const origin = byId.get(id) || visible[0];
    let domain = origin.url || "Browsing journey";
    try { domain = new URL(origin.url).hostname; } catch { /* Partial historical metadata. */ }
    const edges = visible.filter(v => v.id !== id && wanted.has(v.parent)).map(v => [v.parent, v.id]);
    groups.push({ id, name: origin.title || domain, color: colorFor(id), memberIds: visible.map(v => v.id), edges,
      at: visible[0].at, lastAt: visible.at(-1).at, center: { x: (minX + maxX) / 2, y: row + height / 2, z: 0 },
      radius: Math.max(5, (maxX - minX) / 2, height / 2),
      labelPosition: { x: minX + Math.min(16, (maxX - minX) / 2), y: row + height + 6, z: 0 },
      nebulaSize: { x: maxX - minX + 22, y: height + 20 } });
    row += height + 30;
  }
  // Place newest journeys at the top; a later timestamp always remains to the right.
  const offsetX = positions.size ? (Math.min(...[...positions.values()].map(p => p.x)) + Math.max(...[...positions.values()].map(p => p.x))) / 2 : 0;
  const offsetY = Math.max(0, row - 30) / 2;
  for (const p of positions.values()) { p.x -= offsetX; p.y -= offsetY; }
  for (const group of groups) {
    group.center.x -= offsetX; group.center.y -= offsetY;
    group.labelPosition.x -= offsetX; group.labelPosition.y -= offsetY;
  }
  const visibleDays = new Set(visits.map(v => dateKey(v.at)));
  const days = dayRanges.filter(d => visibleDays.has(d.id)).map(d => {
    const xs = visits.filter(v => dateKey(v.at) === d.id).map(v => positions.get(v.id).x);
    return { ...d, start: Math.min(...xs), end: Math.max(...xs), y: offsetY + 19 };
  });
  return { positions, groups, groupOf, days };
}

// Fan sibling links out BEFORE the earliest child. The fan curves share only
// their parent endpoint; subsequent horizontal runs stay in separate subtree
// bands. This avoids the crossings caused by straight chords through a spiral.
export function navigationRoutes(visits, positions) {
  const children = new Map();
  for (const visit of visits) {
    const a = positions.get(visit.parent), b = positions.get(visit.id);
    if (!a || !b || b.x <= a.x) continue;
    if (!children.has(visit.parent)) children.set(visit.parent, []);
    children.get(visit.parent).push(visit);
  }
  const routes = new Map();
  for (const [parent, list] of children) {
    const a = positions.get(parent);
    const forkX = a.x + (Math.min(...list.map(v => positions.get(v.id).x)) - a.x) * .65;
    for (const visit of list) {
      const b = positions.get(visit.id), dx = forkX - a.x;
      const points = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20, u = 1 - t;
        points.push({ x: a.x + dx * (3 * u * u * t * .35 + 3 * u * t * t * .65 + t * t * t),
          y: a.y + (b.y - a.y) * (3 * u * t * t + t * t * t), z: 0 });
      }
      points.push({ ...b });
      routes.set(visit.id, { from: parent, to: visit.id, kind: visit.kind, points });
    }
  }
  return routes;
}
