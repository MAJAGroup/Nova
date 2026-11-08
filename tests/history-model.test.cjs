const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HistoryStore } = require('../history-store');

test('navigation constellations preserve branches and child tabs across dates', async () => {
  const { historyLayout, dateKey } = await import('../ui/components/history/history-layout.mjs');
  const a = new Date(2026, 10, 7, 0, 1).getTime(), b = a + 86400000;
  const data = [
    { id: 'a', at: a, parent: null, url: 'https://example.com', title: 'Research' },
    { id: 'b', at: a + 1, parent: 'a' },
    { id: 'c', at: b, parent: 'a' },
    { id: 'd', at: b + 1, parent: 'c', kind: 'new-tab', journey: 'child-tab' },
    { id: 'independent', at: b + 2, parent: null, url: 'https://example.com' }
  ];
  const shape = historyLayout([...data].reverse());
  assert.equal(shape.groups.length, 2);
  assert.equal(shape.groups[0].name, 'Research');
  assert.deepEqual(shape.groups[0].memberIds, ['a', 'b', 'c', 'd']);
  assert.deepEqual(shape.groups[0].edges, [['a', 'b'], ['a', 'c'], ['c', 'd']]);
  assert.deepEqual(shape.groups[1].edges, []);
  assert.equal(shape.groupOf.get('d'), 'a');
  assert.notEqual(shape.positions.get('a').y, shape.positions.get('b').y);
  assert.ok([...shape.positions.values()].every(p => p.z === 0));
  assert.ok(shape.positions.get('a').x < shape.positions.get('b').x && shape.positions.get('b').x < shape.positions.get('c').x);
  assert.equal(dateKey(new Date(2026, 0, 1, 23, 59)), '2026-01-01');
  // A date/search filter keeps the original root and color without fabricating links.
  const subset = historyLayout([data[1], data[3]], data);
  assert.equal(subset.groups.length, 1);
  assert.equal(subset.groups[0].id, 'a');
  assert.equal(subset.groups[0].color, shape.groups[0].color);
  assert.deepEqual(subset.groups[0].edges, []);
  assert.equal(subset.groups[0].name, 'Research');
});
test('retained fragments and malformed cycles remain finite and distinct', async () => {
  const { historyLayout } = await import('../ui/components/history/history-layout.mjs');
  const data = [{ id: 'a', parent: 'b', at: 1 }, { id: 'b', parent: 'a', at: 2 },
    { id: 'c', parent: 'expired', at: 3 }, { id: 'd', parent: null, at: 4 }];
  const shape = historyLayout(data);
  assert.equal(shape.groups.length, 3);
  for (const position of shape.positions.values()) assert.ok(Object.values(position).every(Number.isFinite));
  assert.deepEqual(historyLayout([]).groups, []);
});
test('real visits retain branches, distinguish repeated URLs, and bind child tabs to exact visits', () => {
  const history = new HistoryStore(null), tab = { id: '1' };
  history.attach(tab);
  const commit = (url, index, fresh = false) => history.commit(tab, { url: 'https://example.com/' + url, title: url, index, fresh });
  const a = commit('A', 0), b = commit('B', 1);
  assert.equal(commit('A', 0).id, a.id);
  const c = commit('C', 1, true);
  history.favicon(tab, 'https://example.com/icon.png');
  assert.equal(c.favicon, 'https://example.com/icon.png');
  assert.equal(c.parent, a.id); assert.equal(b.parent, a.id);
  const repeated = commit('A', 2, true); assert.notEqual(repeated.id, a.id);
  assert.equal(commit('A', 2).id, repeated.id);
  const child = { id: '2' }; history.attach(child, c.id);
  const d = history.commit(child, { url: 'https://example.com/D', title: 'D', index: 0 });
  assert.equal(d.parent, c.id); assert.equal(d.kind, 'new-tab');
  assert.equal(history.snapshot(new Map()).length, 5);
});

test('chronological tree routes do not cross or share a line segment, including interleaved branches', async () => {
  const { historyLayout, navigationRoutes, dateKey } = await import('../ui/components/history/history-layout.mjs');
  const start = new Date(2026, 10, 3, 10).getTime();
  const data = [
    ['r', null], ['a', 'r'], ['a1', 'a'], ['s', null], ['s1', 's'],
    ['b', 'r'], ['b1', 'b'], ['a2', 'a'], ['b2', 'b'], ['a21', 'a2'], ['s2', 's']
  ].map(([id, parent], index) => ({ id, parent, at: start + index * 18000000 }));
  for (let seed = 0; seed < 4; seed++) {
    let random = seed + 91;
    const values = [...data];
    for (let i = 0; i < 45; i++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      values.push({ id: `extra-${i}`, parent: values[random % values.length].id, at: start + (i + data.length) * 18000000 });
    }
    const shape = historyLayout(values);
    const routes = [...navigationRoutes(values, shape.positions).values()];
    assert.equal(routes.length, values.filter(v => v.parent).length);
    const chronological = [...values].sort((a, b) => a.at - b.at);
    for (let i = 1; i < chronological.length; i++) assert.ok(shape.positions.get(chronological[i - 1].id).x < shape.positions.get(chronological[i].id).x);
    assert.deepEqual(shape.days.map(d => d.id), [...new Set(chronological.map(v => dateKey(v.at)))]);
    const segments = routes.flatMap(route => route.points.slice(1).map((p, index) => ({ route: route.to, a: route.points[index], b: p })));
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const epsilon = 1e-8;
    for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
      const { a, b, route: first } = segments[i], { a: c, b: d, route: second } = segments[j];
      if (first === second) continue;
      const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
      assert.ok(!(abC * abD < -epsilon && cdA * cdB < -epsilon), `crossing links ${first} and ${second}`);
      if (Math.abs(abC) < epsilon && Math.abs(abD) < epsilon) {
        const overlapX = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
        const overlapY = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
        assert.ok(!(overlapX > epsilon || overlapY > epsilon), `overlapping links ${first} and ${second}`);
      }
    }
    for (const route of routes) {
      assert.deepEqual(route.points[0], shape.positions.get(route.from));
      assert.deepEqual(route.points.at(-1), shape.positions.get(route.to));
    }
  }
});
