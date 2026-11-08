const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { createServer } = require('node:http');
const { mkdtemp, rm, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('History opens as a dated list and turns live search results into navigation constellations', { timeout: 90000 }, async () => {
  const server = createServer((req, res) => {
    if (req.url === '/icon.svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#39b9cf"/><text x="16" y="23" text-anchor="middle" font-size="23" fill="white">A</text></svg>'); return;
    }
    const name = req.url.split('/')[1] || 'A';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<title>${name} · Research</title><link rel="icon" href="/icon.svg"><h1>${name}</h1><a href="/B">B</a> <a href="/C">C</a><a href="/D" target="_blank">D</a>`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  const profile = await mkdtemp(path.join(os.tmpdir(), 'orbit-dates-'));
  let app, shell;
  const uiErrors = [];
  const oldDate = new Date(); oldDate.setDate(oldDate.getDate() - 2); oldDate.setHours(10, 0, 0, 0);
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(14, 0, 0, 0);
  const seeds = [
    { id: 'seed-1', journey: 'seed', at: +oldDate, title: 'Solar system · Wikipedia', url: url + '/solar', parent: null, kind: 'root' },
    { id: 'seed-2', journey: 'seed', at: +oldDate + 600000, title: 'Planetary orbits · Wikipedia', url: url + '/orbits', parent: 'seed-1', kind: 'navigation' },
    { id: 'seed-3', journey: 'seed', at: +yesterday, title: 'Stars · Astronomy', url: url + '/stars', parent: 'seed-2', kind: 'navigation' }
  ];
  await writeFile(path.join(profile, 'orbit-history.json'), JSON.stringify({ nodes: seeds }));
  const until = async check => { const end = Date.now() + 15000; while (!await check()) { if (Date.now() > end) throw new Error('Timed out waiting for native state'); await new Promise(r => setTimeout(r, 40)); } };
  const history = () => shell.evaluate(() => window.orbitBrowser.getHistory());
  const page = name => until(() => shell.evaluate(name => window.orbitBrowser.getTabs().then(p => p.tabs.some(t => t.active && t.title === name + ' · Research' && !t.loading)), name));
  async function launch() {
    app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, ORBIT_USER_DATA: profile, ORBIT_START_URL: url + '/A', ORBIT_TEST_HIDDEN: '1' } });
    shell = await app.firstWindow(); shell.setDefaultTimeout(10000);
    shell.on('pageerror', error => uiErrors.push(error.message));
    await until(() => shell.evaluate(() => document.documentElement.dataset.orbitReady === 'true'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    await page('A');
  }
  const clickLink = async (from, text) => app.evaluate(({ webContents }, { from, text }) => webContents.getAllWebContents().find(c => c.getURL().endsWith('/' + from)).executeJavaScript(`Array.from(document.querySelectorAll('a')).find(a => a.textContent === ${JSON.stringify(text)}).click()`, true), { from, text });
  try {
    await launch();
    await clickLink('A', 'B'); await page('B');
    await shell.evaluate(() => window.orbitBrowser.goBack()); await page('A');
    await clickLink('A', 'C'); await page('C');
    const data = await history(), a = data.find(n => n.title === 'A · Research'), b = data.find(n => n.title === 'B · Research'), c = data.find(n => n.title === 'C · Research');
    assert.equal(b.parent, a.id); assert.equal(c.parent, a.id);
    await until(async () => (await history()).some(n => n.id === c.id && n.favicon === url + '/icon.svg'));
    await clickLink('C', 'D'); await page('D');
    const d = (await history()).find(n => n.title === 'D · Research');
    assert.equal(d.parent, c.id); assert.equal(d.kind, 'new-tab');
    await shell.locator('#history-tab').click();
    const historyButton = await shell.locator('#history-tab').boundingBox();
    const toolbar = await shell.locator('.browser-toolbar').boundingBox();
    assert.ok(historyButton.x > toolbar.width - 60 && historyButton.y < 44);
    assert.equal(await shell.locator('#history').getAttribute('data-view'), 'list');
    assert.equal(await shell.locator('.history-entry-list [data-visit-id]').count(), 7);
    assert.equal(await shell.locator('.history-entry-list [data-visit-id]').first().getAttribute('data-visit-id'), d.id);
    assert.equal(await shell.locator('.history-entry-day').count(), 3);
    assert.equal(await shell.locator('#history .cosmos-canvas').count(), 0); // Created only after typing.
    assert.equal(await shell.locator('.history-stage').isVisible(), false);
    await mkdir('artifacts', { recursive: true });
    await shell.screenshot({ path: 'artifacts/history-list.png' });
    const searchBox = await shell.locator('.history-search').boundingBox();
    await shell.locator('.history-search').fill('Research');
    await until(async () => await shell.locator('#history').getAttribute('data-view') === 'stars');
    await until(async () => await shell.locator('#history .star-label').count() === 4);
    assert.equal(await shell.locator('.history-visits [data-visit-id]').count(), 4);
    assert.equal(await shell.locator('#history .constellation-label').count(), 1);
    assert.equal(await shell.locator('#history .star-label-mark img').first().getAttribute('src'), url + '/icon.svg');
    assert.equal(await shell.locator('.history-list-view').isVisible(), false);
    const mapSearchBox = await shell.locator('.history-search').boundingBox();
    assert.equal(mapSearchBox.x, searchBox.x); assert.equal(mapSearchBox.y, searchBox.y);
    // Broader input rearranges the matches across all dates, keeping genuine branches.
    await shell.locator('.history-search').fill('127.0.0.1');
    await until(async () => await shell.locator('#history .star-label').count() === 7);
    assert.equal(await shell.locator('#history .constellation-label').count(), 2);
    assert.equal(await shell.locator('#history .history-date-label').count(), 3);
    await shell.locator('.history-dates [data-date]').last().click();
    await until(async () => await shell.locator('#history .star-label.subdued').count() === 5);
    assert.equal(await shell.locator('.history-visits [data-visit-id]').count(), 7);
    await shell.getByRole('button', { name: 'All dates', exact: true }).click();
    await shell.getByRole('button', { name: 'Hide history list', exact: true }).click();
    assert.equal(await shell.locator('#history-sidebar').evaluate(el => el.inert), true);
    await shell.getByRole('button', { name: 'Show history list', exact: true }).click();
    assert.equal(await shell.locator('#history-sidebar').evaluate(el => el.inert), false);
    await shell.locator(`.history-visits [data-visit-id="${c.id}"]`).click();
    await shell.getByRole('heading', { name: 'C · Research' }).waitFor();
    assert.equal(await shell.locator('.history-related').count(), 2);
    await shell.locator('#assistant-reopen').click();
    const hb = await shell.locator('#history').boundingBox(), ab = await shell.locator('.assistant-panel').boundingBox();
    assert.ok(hb.x + hb.width <= ab.x + 1);
    await shell.locator('#assistant-minimize').click();
    await shell.locator('.history-search').fill('Solar');
    await until(async () => await shell.locator('#history .star-label').count() === 1);
    assert.equal(await shell.locator('.history-visits [data-visit-id]').count(), 1);
    await shell.locator('.history-search').fill('no-match-for-this-query');
    await until(async () => await shell.locator('#history .star-label').count() === 0);
    assert.equal(await shell.locator('.history-empty').isVisible(), true);
    assert.equal(await shell.locator('.history-visits [data-visit-id]').count(), 0);
    await shell.getByRole('button', { name: 'Clear history search', exact: true }).click();
    assert.equal(await shell.locator('#history').getAttribute('data-view'), 'list');
    assert.equal(await shell.locator('.history-entry-list [data-visit-id]').count(), 7);
    await shell.locator('.history-search').fill('Research');
    await shell.locator('.history-search').press('Escape');
    assert.equal(await shell.locator('#history').isVisible(), true);
    assert.equal(await shell.locator('#history').getAttribute('data-view'), 'list');
    await shell.locator('.history-search').fill('   ');
    assert.equal(await shell.locator('#history').getAttribute('data-view'), 'list');
    // Reopening resets any query and returns to the ordinary recent-history list.
    await shell.locator('.history-search').fill('Solar');
    await shell.locator('#history-tab').click(); await shell.locator('#history-tab').click();
    assert.equal(await shell.locator('.history-search').inputValue(), '');
    assert.equal(await shell.locator('#history').getAttribute('data-view'), 'list');
    await shell.locator('.history-entry-list [data-visit-id="seed-1"]').click(); await page('solar');
    assert.equal(await shell.locator('#history').isVisible(), false);
    assert.equal((await history()).find(n => n.title === 'solar · Research').parent, 'seed-1');
    await shell.locator('#cosmos-tab').click();
    await shell.locator('#cosmos .star-label').first().waitFor();
    await shell.locator('#history-tab').click();
    assert.equal(await shell.locator('#cosmos').isVisible(), false);
    assert.equal(await shell.locator('#history').getAttribute('data-view'), 'list');
    await shell.locator('.history-search').fill('127.0.0.1');
    await shell.locator('.history-fit').click();
    await shell.emulateMedia({ reducedMotion: 'reduce' });
    await until(async () => await shell.locator('#history .star-label').count() === 8);
    await shell.screenshot({ path: 'artifacts/history-search-constellations.png' });
    assert.deepEqual(uiErrors, []);
    const savedId = c.id;
    await app.close(); app = null;
    await launch(); assert.ok((await history()).some(n => n.id === savedId && n.favicon === url + '/icon.svg'));
    await shell.locator('#history-tab').click();
    assert.equal(await shell.locator('#history').getAttribute('data-view'), 'list');
    await shell.locator('.history-clear').click(); await shell.locator('.history-delete').click();
    await until(async () => (await history()).length === 0);
    assert.equal(await shell.locator('.history-entry-list [data-visit-id]').count(), 0);
    assert.equal(await shell.locator('.history-list-empty').isVisible(), true);
  } catch (error) {
    if (shell && !shell.isClosed()) { await mkdir('artifacts', { recursive: true }); await shell.screenshot({ path: 'artifacts/history-search-failure.png', timeout: 5000 }).catch(() => {}); }
    throw error;
  } finally { if (app) await app.close(); await new Promise(r => server.close(r)); await rm(profile, { recursive: true, force: true }); }
});

test('history lists older entries in pages and searches saved visits beyond the loaded list', { timeout: 60000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'orbit-history-list-'));
  const start = new Date(2026, 9, 1, 9).getTime();
  const nodes = Array.from({ length: 130 }, (_, i) => ({ id: `saved-${i}`, journey: `journey-${i}`, at: start + i * 60000, title: `Saved page ${i}`, url: `https://example.test/saved/${i}`, parent: null, kind: 'root' }));
  await writeFile(path.join(profile, 'orbit-history.json'), JSON.stringify({ nodes }));
  let app;
  try {
    app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, ORBIT_USER_DATA: profile, ORBIT_START_URL: '', ORBIT_TEST_HIDDEN: '1' } });
    const shell = await app.firstWindow(); shell.setDefaultTimeout(10000);
    const until = async predicate => {
      const end = Date.now() + 10000;
      while (!await predicate()) { if (Date.now() > end) throw new Error('Timed out waiting for history list'); await new Promise(r => setTimeout(r, 40)); }
    };
    await until(() => shell.evaluate(() => document.documentElement.dataset.orbitReady === 'true'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    await shell.locator('#history-tab').click();
    await until(async () => await shell.locator('.history-entry').count() === 100);
    assert.equal(await shell.locator('.history-entry').first().getAttribute('data-visit-id'), 'saved-129');
    assert.equal(await shell.locator('#history .cosmos-canvas').count(), 0);
    await shell.locator('.history-search').fill('/saved/0');
    await until(async () => await shell.locator('#history .star-label').count() === 1);
    assert.equal(await shell.locator('.history-visits [data-visit-id]').first().getAttribute('data-visit-id'), 'saved-0');
    await shell.locator('.history-search-clear').click();
    await shell.locator('.history-load-more').click();
    assert.equal(await shell.locator('.history-entry').count(), 130);
    assert.equal(await shell.locator('.history-entry').last().getAttribute('data-visit-id'), 'saved-0');
    assert.equal(await shell.locator('.history-load-more').isVisible(), false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 740));
    await shell.locator('#assistant-reopen').click();
    const hb = await shell.locator('#history').boundingBox(), sb = await shell.locator('.history-search').boundingBox();
    assert.ok(sb.x >= hb.x && sb.x + sb.width <= hb.x + hb.width);
    assert.equal(await shell.locator('#history').getAttribute('data-view'), 'list');
  } finally { if (app) await app.close(); await rm(profile, { recursive: true, force: true }); }
});
