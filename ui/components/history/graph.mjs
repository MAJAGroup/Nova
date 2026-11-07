// Parent IDs always precede children in the persisted visit log. Layout is
// iterative so long browsing sessions cannot overflow the JavaScript stack.
export function layoutHistory(visits, { query = "", collapsed = new Set(), positions = {} } = {}) {
  const all = new Map(visits.map(n => [n.id, n]));
  const matches = new Set(visits.filter(n => `${n.title} ${n.url}`.toLowerCase().includes(query.toLowerCase())).map(n => n.id));
  const included = new Set(matches);
  if (query) for (const id of matches) {
    let parent = all.get(id)?.parent;
    while (parent && all.has(parent) && !included.has(parent)) { included.add(parent); parent = all.get(parent).parent; }
  }
  const hidden = new Set();
  const nodes = [];
  const byId = new Map();
  for (const visit of visits) {
    if (hidden.has(visit.parent) || (!query && collapsed.has(visit.parent))) hidden.add(visit.id);
    if (hidden.has(visit.id) || !included.has(visit.id)) continue;
    const parent = byId.get(visit.parent);
    const node = { ...visit, depth: parent ? parent.depth + 1 : 0, children: [], matched: matches.has(visit.id) };
    if (parent) parent.children.push(node.id);
    nodes.push(node); byId.set(node.id, node);
  }
  let row = 0;
  // Walk each tree in depth-first order to keep branches together.
  const stack = nodes.filter(n => !byId.has(n.parent)).reverse().map(n => [n, false]);
  while (stack.length) {
    const [node, after] = stack.pop();
    if (!after && node.children.length) {
      stack.push([node, true]);
      for (const id of [...node.children].reverse()) stack.push([byId.get(id), false]);
    } else {
      node.x = 110 + node.depth * 250;
      node.y = node.children.length
        ? node.children.reduce((sum, id) => sum + byId.get(id).y, 0) / node.children.length
        : 110 + row++ * 160;
    }
  }
  for (const node of nodes) if (positions[node.id]) Object.assign(node, positions[node.id]);
  return { nodes, edges: nodes.filter(n => byId.has(n.parent)).map(n => ({ from: n.parent, to: n.id, kind: n.kind })), matches: matches.size };
}
export function graphBounds(nodes) {
  if (!nodes.length) return { x: 0, y: 0, width: 500, height: 300 };
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const x = Math.min(...xs) - 110, y = Math.min(...ys) - 65;
  return { x, y, width: Math.max(...xs) - x + 110, height: Math.max(...ys) - y + 110 };
}
export function zoomAt(camera, factor, x, y) {
  const zoom = Math.max(.15, Math.min(2.5, camera.zoom * factor));
  return { zoom, x: x - (x - camera.x) * zoom / camera.zoom, y: y - (y - camera.y) * zoom / camera.zoom };
}
