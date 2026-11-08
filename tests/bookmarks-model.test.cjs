const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { BookmarkStore, bookmarkUrl } = require('../bookmark-store');
const { localSuggestions } = require('../search-suggestions.cjs');

test('bookmarks persist atomically, deduplicate URLs, preserve identity and date when edited, and remove independently', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orbit-bookmarks-model-'));
  try {
    const file = path.join(dir, 'bookmarks.json'), store = new BookmarkStore(file);
    const first = store.save({ title: 'Space', url: 'https://example.com', favicon: 'https://example.com/icon.png' });
    const duplicate = store.save({ title: 'Space renamed', url: 'https://example.com/' });
    assert.equal(duplicate.id, first.id); assert.equal(duplicate.at, first.at); assert.equal(store.items.length, 1);
    const other = store.save({ title: 'Other', url: 'https://other.test/' });
    assert.throws(() => store.save({ id: first.id, url: other.url }), /already bookmarked/);
    assert.equal(store.items.length, 2);
    const edited = store.save({ id: first.id, title: '<script>literal text</script>', url: 'https://example.com/Updated?q=1#two' });
    assert.equal(edited.id, first.id); assert.equal(edited.at, first.at); assert.equal(edited.favicon, '');
    assert.equal(new BookmarkStore(file).items[0].title, '<script>literal text</script>');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const snapshot = store.snapshot(new Map([['tab', { id: 'tab', url: edited.url }]]));
    assert.equal(snapshot[0].liveTabId, 'tab'); snapshot[0].title = 'mutated'; assert.notEqual(store.items[0].title, 'mutated');
    store.remove(first.id); assert.deepEqual(new BookmarkStore(file).items.map(item => item.id), [other.id]);
    store.clear(); assert.deepEqual(JSON.parse(readFileSync(file)).bookmarks, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bookmarks reject executable and internal URLs, strip credentials, and leave unreadable files alone', () => {
  const store = new BookmarkStore(null);
  for (const value of ['javascript:alert(1)', 'file:///secret', 'orbit://newtab', 'data:text/html,test', 'example.com', null]) {
    assert.throws(() => store.save({url:value}));
  }
  assert.equal(bookmarkUrl('https://user:password@example.com/Path?q=keep#part'), 'https://example.com/Path?q=keep#part');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orbit-bookmarks-bad-'));
  try {
    const file = path.join(dir, 'bookmarks.json'); writeFileSync(file, '{broken');
    assert.throws(() => new BookmarkStore(file)); assert.equal(readFileSync(file, 'utf8'), '{broken');
    const failed = new BookmarkStore(null); failed.file = dir; // Renaming a file onto a directory must fail.
    assert.throws(() => failed.save({ url:'https://example.com/' })); assert.deepEqual(failed.items, []);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(dir + '.tmp', { force: true }); }
});

test('bookmark constellations group by website, keep saved dates, and retain groups when their root is filtered', async () => {
  const { bookmarkVisits, bookmarksLayout } = await import('../ui/components/bookmarks/bookmarks-layout.mjs');
  const visits = bookmarkVisits([
    { id: 'b', title: 'Two', url: 'https://www.example.com/two', at: 2 },
    { id: 'a', title: 'One', url: 'https://example.com/one', at: 1 },
    { id: 'c', title: 'Other', url: 'https://other.test/', at: 3 }
  ]);
  assert.equal(visits[1].parent, 'a'); assert.equal(visits[2].parent, null);
  const shape = bookmarksLayout(visits);
  assert.equal(shape.groups.length, 2); assert.equal(shape.groups[0].name, 'example.com');
  assert.deepEqual(shape.groups[0].edges, [['a','b']]);
  const filtered = bookmarksLayout([visits[1]], visits);
  assert.equal(filtered.groups[0].name, 'example.com'); assert.deepEqual(filtered.groups[0].edges, []);
  assert.equal(filtered.positions.size, 1); assert.equal(visits[1].at, 2);
  for (const point of shape.positions.values()) assert.ok(Object.values(point).every(Number.isFinite));
});

test('saved pages appear in suggestions after history is cleared, without duplicate history or tab rows', () => {
  const bookmark = { id:'b', url:'https://space.test/', title:'Space guide', at:1 };
  let rows = localSuggestions('Space', { bookmarks:[bookmark], visits:[{ ...bookmark, at:4 }] });
  assert.equal(rows[1].source, 'bookmark'); assert.equal(rows.length, 2);
  rows = localSuggestions('Space', { bookmarks:[bookmark], tabs:[{ ...bookmark, id:'tab' }] });
  assert.equal(rows[1].source, 'tab'); assert.equal(rows.length, 2);
  assert.equal(localSuggestions('Space', { bookmarks:[bookmark] })[1].source, 'bookmark');
});
