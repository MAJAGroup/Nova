const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { HistoryStore } = require('../history-store');
const visit = (store, tab, url, index, fresh = false) => store.commit(tab, { url: 'https://example.org/' + url, title: url, index, fresh });

test('native back/forward preserves visits, new navigation forks and repeated URLs remain distinct', () => {
  const history = new HistoryStore(null), tab = { id: '1' }; history.attach(tab);
  const a = visit(history, tab, 'A', 0), b = visit(history, tab, 'B', 1);
  assert.equal(visit(history, tab, 'A', 0).id, a.id);
  assert.equal(visit(history, tab, 'B', 1).id, b.id);
  visit(history, tab, 'A', 0);
  const c = visit(history, tab, 'C', 1, true);
  assert.equal(c.parent, a.id); assert.equal(b.parent, a.id);
  const repeat = visit(history, tab, 'A', 2, true);
  assert.notEqual(repeat.id, a.id); assert.equal(repeat.parent, c.id);
  assert.equal(visit(history, tab, 'A', 2).id, repeat.id); // reload
  assert.equal(history.nodes.length, 4);
});
test('new-tab edge targets the exact opener visit, closed tabs retain history', () => {
  const history = new HistoryStore(null), parent = { id: '1' }, child = { id: '2' };
  history.attach(parent); const a = visit(history, parent, 'A', 0);
  history.attach(child, a.id); visit(history, parent, 'B', 1);
  const c = visit(history, child, 'C', 0);
  assert.equal(c.kind, 'new-tab'); assert.equal(c.parent, a.id);
  assert.equal(history.snapshot(new Map()).length, 3);
  assert.ok(history.snapshot(new Map()).every(n => n.liveTabId === null));
});
test('history persists, pruning leaves valid edges, clearing removes persisted history', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'orbit-history-unit-'));
  try {
    const file = path.join(dir, 'history.json'), history = new HistoryStore(file, 3), tab = { id: '1' };
    history.attach(tab); for (let i = 0; i < 5; i++) visit(history, tab, String(i), i);
    history.flush(); const restored = new HistoryStore(file, 3);
    assert.equal(restored.nodes.length, 3); assert.equal(restored.nodes[0].parent, null);
    history.clear(new Map([['1', tab]])); assert.equal(tab.currentVisit, null);
    assert.deepEqual(JSON.parse(readFileSync(file)).nodes, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('graph preserves branches, searches ancestors, collapses descendants and applies manual positions', async () => {
  const { layoutHistory, graphBounds, zoomAt } = await import('../ui/components/history/graph.mjs');
  const nodes = [
    { id: 'a', title: 'A', url: 'https://a', parent: null },
    { id: 'b', title: 'B', url: 'https://b', parent: 'a' },
    { id: 'c', title: 'C', url: 'https://c', parent: 'a' },
    { id: 'd', title: 'D', url: 'https://d', parent: 'b' }
  ];
  const graph = layoutHistory(nodes);
  assert.equal(graph.edges.length, 3); assert.equal(new Set(graph.nodes.map(n => `${n.x}:${n.y}`)).size, 4);
  assert.deepEqual(layoutHistory(nodes, { query: 'D' }).nodes.map(n => n.id), ['a', 'b', 'd']);
  assert.deepEqual(layoutHistory(nodes, { collapsed: new Set(['b']) }).nodes.map(n => n.id), ['a', 'b', 'c']);
  assert.equal(layoutHistory(nodes, { positions: { a: { x: 42, y: 42 } } }).nodes[0].x, 42);
  assert.ok(graphBounds(graph.nodes).width > 500);
  const old = { x: 10, y: 20, zoom: 1 }, next = zoomAt(old, 1.5, 200, 100);
  assert.equal((200 - old.x) / old.zoom, (200 - next.x) / next.zoom);
});
