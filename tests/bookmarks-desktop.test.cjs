const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const { createServer } = require('node:http');
const { mkdtemp, rm, mkdir, readFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('bookmarks save, edit, search, form website constellations, open live tabs, remove and survive restart independently of history', { timeout: 90000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'nova-bookmarks-'));
  const server = createServer((req, res) => {
    if (req.url === '/icon.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" rx="6" fill="#80ccdd"/></svg>'); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<title>${req.url === '/A' ? 'Atlas' : 'Notes'} fixture</title><link rel="icon" href="/icon.svg"><h1>Bookmark fixture</h1>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let app, shell, stage = 'startup'; const errors = [];
  const until = async predicate => {
    const end = Date.now() + 12000;
    while (!await predicate()) { if (Date.now() > end) throw Error('Timed out: ' + stage); await new Promise(resolve => setTimeout(resolve, 40)); }
  };
  const all = () => shell.evaluate(() => window.novaBrowser.getBookmarks());
  const active = () => shell.evaluate(async () => { const data = await window.novaBrowser.getTabs(); return data.tabs.find(t => t.id === data.activeId); });
  async function launch() {
    app = await _electron.launch({ args: [path.resolve('.')], env: { ...process.env, NOVA_USER_DATA: profile, NOVA_START_URL: base + '/A', NOVA_TEST_HIDDEN: '1' } });
    // The assistant handle is also a native WebContentsView. Select the shell
    // by its actual URL rather than whichever renderer reports itself first.
    await until(() => { shell = app.windows().find(page => page.url().endsWith('/ui/index.html')); return Boolean(shell); });
    shell.setDefaultTimeout(10000); shell.on('pageerror', error => errors.push(error.message));
    await shell.waitForFunction(() => document.documentElement.dataset.novaReady === 'true');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    await until(async () => (await active())?.url === base + '/A' && !(await active()).loading);
  }
  const editor = () => shell.locator('#bookmark-editor');
  const saveEditor = async () => { await shell.locator('#bookmark-editor-form [type="submit"]').click(); await editor().waitFor({ state: 'hidden' }); };
  const manager = () => shell.locator('#bookmarks');
  try {
    await launch();
    stage = 'empty manager';
    await shell.locator('#bookmarks-tab').click();
    await manager().waitFor({ state: 'visible' });
    assert.equal(await manager().getAttribute('data-view'), 'stars');
    assert.match(await manager().locator('.history-empty').textContent(), /Save a page/);
    assert.equal(await shell.locator('#bookmarks-tab').getAttribute('aria-pressed'), 'true');
    await manager().locator('.history-close').click();

    stage = 'save and edit current page';
    await shell.locator('#bookmark-page').click(); await editor().waitFor({ state: 'visible' });
    assert.equal((await all()).length, 1);
    const first = (await all())[0];
    await shell.locator('#bookmark-title').fill('Research Atlas'); await saveEditor();
    assert.equal(await shell.locator('#bookmark-page').getAttribute('aria-pressed'), 'true');
    await shell.locator('#bookmark-page').click(); await editor().waitFor({ state: 'visible' });
    assert.equal(await shell.locator('#bookmark-title').inputValue(), 'Research Atlas');
    assert.equal((await all()).length, 1);
    assert.equal((await all())[0].at, first.at);
    await shell.locator('#bookmark-editor-cancel').click();
    await shell.evaluate(url => window.novaBrowser.navigate(url), base + '/B');
    await until(async () => (await active()).url === base + '/B' && !(await active()).loading);
    assert.equal(await shell.locator('#bookmark-page').getAttribute('aria-pressed'), 'false');
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === 'File').submenu.items.find(item => item.label === 'Bookmark This Page').click());
    await editor().waitFor({ state: 'visible' });
    await shell.locator('#bookmark-title').fill('Research <script>literal</script>');
    await shell.locator('#bookmark-url').fill('javascript:alert(1)');
    await shell.locator('#bookmark-editor-form [type="submit"]').click();
    await shell.locator('#bookmark-editor-error').waitFor({ state: 'visible' });
    assert.equal((await all())[1].url, base + '/B');
    await shell.locator('#bookmark-url').fill(base + '/renamed'); await saveEditor();
    assert.equal((await all()).length, 2);
    assert.equal(await shell.locator('#bookmark-page').getAttribute('aria-pressed'), 'false');
    const second = (await all()).find(item => item.id !== first.id);

    stage = 'shared universe, list and search views';
    await shell.locator('#bookmarks-tab').click();
    await until(async () => await manager().locator('.star-label').count() === 2);
    assert.equal(await manager().locator('.constellation-label').count(), 1);
    assert.equal(await manager().locator('.cosmos-group-name').textContent(), '127.0.0.1');
    await mkdir('artifacts', { recursive: true });
    await shell.screenshot({ path: 'artifacts/bookmarks-universe.png' });
    await manager().locator('[data-mode="list"]').click();
    assert.equal(await manager().getAttribute('data-view'), 'list');
    assert.equal(await manager().locator('.history-entry').count(), 2);
    assert.equal(await manager().locator('.history-entry').first().getAttribute('data-visit-id'), second.id);
    assert.equal(await manager().locator('.history-entry-list script').count(), 0);
    await shell.screenshot({ path: 'artifacts/bookmarks-list.png' });
    await manager().locator('.history-search').fill('Research Atlas');
    await until(async () => await manager().locator('.star-label').count() === 1);
    assert.equal(await manager().getAttribute('data-view'), 'stars');
    await manager().locator('.history-search').fill('does not exist');
    await manager().locator('.history-empty').waitFor({ state: 'visible' });
    await manager().locator('.history-search').press('Escape');
    assert.equal(await manager().getAttribute('data-view'), 'list');
    await manager().locator('[data-mode="timeline"]').click();
    assert.equal(await manager().locator('.history-timeline-item').count(), 2);
    await manager().locator(`.history-timeline-item[data-visit-id="${first.id}"]`).click();
    await manager().locator('.history-related').click();
    assert.equal(await manager().locator('.history-details h2').textContent(), second.title);
    await manager().locator(`.history-timeline-item[data-visit-id="${first.id}"]`).click();
    await manager().locator('.history-details .bookmark-edit').click();
    await editor().waitFor({ state: 'visible' });
    await shell.locator('#bookmark-title').press('Escape');
    await editor().waitFor({ state: 'hidden' });
    assert.equal(await manager().isVisible(), true);

    stage = 'history stays separate and suggestions include bookmarks';
    await shell.locator('#history-tab').click();
    assert.equal(await manager().isHidden(), true);
    await shell.locator('#history').waitFor({ state: 'visible' });
    await shell.locator('#history [data-mode="list"]').click();
    assert.ok(await shell.locator('#history .history-entry').count() >= 2);
    await shell.evaluate(() => window.novaBrowser.clearHistory());
    assert.equal((await all()).length, 2);
    assert.deepEqual(await shell.evaluate(() => window.novaBrowser.getHistory()), []);
    const rows = await shell.evaluate(() => window.novaBrowser.getLocalSuggestions('Research Atlas'));
    assert.equal(rows[1].source, 'bookmark');
    await shell.locator('#bookmarks-tab').click();
    await manager().locator('[data-mode="list"]').click();
    await manager().locator(`.history-entry[data-visit-id="${first.id}"]`).click();
    await until(async () => (await active()).url === base + '/A' && !(await active()).loading);
    assert.equal(await manager().isHidden(), true);
    const tabCount = (await shell.evaluate(() => window.novaBrowser.getTabs())).tabs.length;
    await shell.locator('#bookmarks-tab').click();
    await manager().locator(`.history-entry[data-visit-id="${first.id}"]`).click();
    await manager().waitFor({ state: 'hidden' });
    assert.equal((await shell.evaluate(() => window.novaBrowser.getTabs())).tabs.length, tabCount);
    await shell.locator('#bookmarks-tab').click();
    await manager().locator(`.history-entry[data-visit-id="${second.id}"]`).locator('..').locator('.bookmark-remove').click();
    await until(async () => (await all()).length === 1);
    assert.equal((await all())[0].id, first.id);

    stage = 'narrow layout and page state';
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 740));
    await shell.locator('#assistant-reopen').click();
    await until(() => manager().evaluate(root => root.getBoundingClientRect().width < 600));
    assert.equal(await manager().evaluate(root => {
      const box = root.getBoundingClientRect(); return [...root.querySelectorAll('.history-topbar > *')].filter(el => getComputedStyle(el).display !== 'none').every(el => {
        const r=el.getBoundingClientRect(); return r.width > 0 && r.left>=box.left && r.right<=box.right+1;
      });
    }), true);
    await shell.screenshot({ path: 'artifacts/bookmarks-narrow.png' });
    await shell.locator('#assistant-minimize').click();
    await manager().locator('.history-close').click();
    await shell.locator('#new-tab').click();
    await until(async () => (await active()).isStartPage && !(await active()).loading);
    assert.equal(await shell.locator('#bookmark-page').isDisabled(), true);
    assert.equal((await all()).length, 1);
    const saved = JSON.parse(await readFile(path.join(profile, 'nova-bookmarks.json'), 'utf8'));
    assert.equal(saved.bookmarks[0].title, 'Research Atlas');
    await app.close(); app = null;

    stage = 'restart persistence and explicit clear confirmation';
    await launch();
    assert.equal((await all())[0].id, first.id);
    assert.equal(await shell.locator('#bookmark-page').getAttribute('aria-pressed'), 'true');
    await shell.locator('#bookmarks-tab').click();
    await manager().locator('.history-clear').click();
    await manager().locator('.history-cancel').click(); assert.equal((await all()).length, 1);
    await manager().locator('.history-clear').click();
    await manager().locator('.history-delete').click();
    await until(async () => (await all()).length === 0);
    assert.equal(await shell.locator('#bookmark-page').getAttribute('aria-pressed'), 'false');
    assert.deepEqual(errors, []);
  } catch (failure) {
    console.error('Bookmark test stage:', stage);
    if (shell && !shell.isClosed()) { await mkdir('artifacts', { recursive: true }); await shell.screenshot({ path: 'artifacts/bookmarks-failure.png' }).catch(() => {}); }
    throw failure;
  } finally {
    if (app) await app.close();
    await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    await rm(profile, { recursive: true, force: true });
  }
});
