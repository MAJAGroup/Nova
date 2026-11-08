const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { createServer } = require('node:http');
const { mkdtemp, rm, mkdir } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('native history constellation: traversal, branches, popup, canvas, persistence and clear', { timeout: 90000 }, async () => {
  const server = createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'A';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<title>${name} · Journey</title><h1>${name}</h1><a href="/B">To B</a> <a href="/C">To C</a> <a href="/D" target="_blank">New D</a><a href="#section">Section</a><input aria-label="Notes"><div id="section">Section</div>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const profile = await mkdtemp(path.join(os.tmpdir(), 'orbit-history-desktop-'));
  let app, shell;
  const until = async (check) => {
    const deadline = Date.now() + 15000;
    while (!await check()) { if (Date.now() > deadline) throw new Error('Timed out waiting for native browser state'); await new Promise(r => setTimeout(r, 40)); }
  };
  const launch = async () => {
    app = await electron.launch({ executablePath: process.env.ORBIT_TEST_EXECUTABLE || require('electron'), args: process.env.ORBIT_TEST_EXECUTABLE ? [] : [path.resolve('.')], env: { ...process.env, ORBIT_USER_DATA: profile, ORBIT_TEST_HIDDEN: '1', ORBIT_START_URL: url + '/A' } });
    shell = await app.firstWindow();
    shell.setDefaultTimeout(12000);
    shell.on("pageerror", error => console.error("Shell error:", error.message));
    await until(() => shell.evaluate(() => document.documentElement.dataset.orbitReady === 'true'));
    await until(() => shell.evaluate(() => window.orbitBrowser.getHistory().then(nodes => nodes.some(n => n.title === 'A · Journey'))));
  };
  const history = () => shell.evaluate(() => window.orbitBrowser.getHistory());
  const waitPage = async name => until(() => shell.evaluate(name => window.orbitBrowser.getTabs().then(p => p.tabs.some(t => t.active && t.title === name + ' · Journey' && !t.loading)), name));
  const nativeClick = async text => {
    await app.evaluate(({ webContents }, text) => {
      const page = webContents.getAllWebContents().find(c => c.getURL().startsWith('http://127.0.0.1:') && c.getURL().includes('/' + text.from));
      return page.executeJavaScript(`Array.from(document.querySelectorAll('a')).find(a => a.textContent === ${JSON.stringify(text.label)}).click()`, true);
    }, text);
  };
  try {
    await launch(); await waitPage('A');
    assert.equal(await shell.locator('.tab-row #cosmos-tab').count(), 1);
    assert.equal(await shell.locator('#cosmos-stage').count(), 1);
    assert.equal(await shell.locator('#cosmos-tab-list').count(), 1);
    await shell.locator('#assistant-reopen').click();
    assert.equal(await shell.locator('#assistant').evaluate(n => n.classList.contains('expanded')), true);
    await shell.locator('#assistant-minimize').click();
    assert.equal(await shell.locator('#assistant').evaluate(n => n.classList.contains('expanded')), false);
    const a = (await history())[0];
    await nativeClick({ from: 'A', label: 'To B' }); await waitPage('B');
    const b = (await history()).find(n => n.title === 'B · Journey'); assert.equal(b.parent, a.id);
    await shell.evaluate(() => window.orbitBrowser.goBack()); await waitPage('A');
    assert.equal((await history()).length, 2);
    await shell.evaluate(() => window.orbitBrowser.goForward()); await waitPage('B');
    assert.equal((await history()).length, 2);
    await shell.evaluate(() => window.orbitBrowser.goBack()); await waitPage('A');
    await nativeClick({ from: 'A', label: 'To C' }); await waitPage('C');
    const c = (await history()).find(n => n.title === 'C · Journey'); assert.equal(c.parent, a.id);
    await shell.evaluate(() => window.orbitBrowser.reload()); await waitPage('C');
    assert.equal((await history()).length, 3);
    await nativeClick({ from: 'C', label: 'New D' }); await waitPage('D');
    const d = (await history()).find(n => n.title === 'D · Journey'); assert.equal(d.parent, c.id); assert.equal(d.kind, 'new-tab');
    await shell.evaluate(() => window.orbitBrowser.getTabs().then(p => window.orbitBrowser.closeTab(p.activeId))); await waitPage('C');
    assert.equal((await history()).length, 4); assert.equal((await history()).find(n => n.id === d.id).liveTabId, null);
    await shell.locator('#history-toggle').click();
    await shell.locator('#assistant-reopen').click();
    const historyBox = await shell.locator('#history').boundingBox();
    const assistantBox = await shell.locator('.assistant-panel').boundingBox();
    assert.ok(historyBox.x + historyBox.width <= assistantBox.x + 1);
    await shell.locator('#assistant-minimize').click();
    await shell.locator('[data-history="fit"]').click();
    assert.equal(await shell.locator('.history-star').count(), 4);
    assert.equal(await shell.locator('.history-edges > path').count(), 3);
    await shell.locator(`.history-star[data-id="${a.id}"]`).click();
    assert.equal(await shell.locator('.history-inspector .history-related').count(), 2);
    await shell.getByRole('button', { name: 'Collapse this branch' }).click();
    assert.equal(await shell.locator('.history-star').count(), 1);
    await shell.getByRole('button', { name: 'Expand this branch' }).click();
    assert.equal(await shell.locator('.history-star').count(), 4);
    const search = shell.getByRole('searchbox'); await search.fill('D · Journey');
    assert.equal(await shell.locator('.history-star').count(), 3); await search.fill('');
    const star = shell.locator(`.history-star[data-id="${b.id}"]`), box = await star.boundingBox();
    const before = await star.evaluate(n => n.style.left);
    await shell.mouse.move(box.x + box.width / 2, box.y + 25); await shell.mouse.down(); await shell.mouse.move(box.x + box.width / 2 + 50, box.y + 60, { steps: 5 }); await shell.mouse.up();
    assert.notEqual(await star.evaluate(n => n.style.left), before);
    await shell.locator('.history-viewport').focus();
    const camera = await shell.locator('.history-scene').getAttribute('style'); await shell.keyboard.press('ArrowLeft');
    assert.notEqual(await shell.locator('.history-scene').getAttribute('style'), camera);
    await shell.keyboard.press('f');
    await shell.locator(`.history-star[data-id="${c.id}"]`).click();
    await mkdir('artifacts', { recursive: true }); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    await shell.screenshot({ path: 'artifacts/history-constellation.png', timeout: 5000 });
    await shell.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await shell.locator('.history-star-light').first().evaluate(n => getComputedStyle(n).animationName), 'none');
    await shell.getByRole('button', { name: 'List', exact: true }).click();
    assert.equal(await shell.locator('.history-list-row').count(), 4);
    await shell.locator(`.history-list-row[data-id="${d.id}"]`).click();
    await shell.getByRole('button', { name: 'Open page in a new tab' }).click(); await waitPage('D');
    assert.equal(await shell.locator('#history').isVisible(), false);
    assert.equal((await history()).length, 5);
    await app.close(); app = null;
    await launch();
    assert.ok((await history()).some(n => n.id === b.id));
    await shell.locator('#history-toggle').click();
    await shell.getByRole('button', { name: 'Clear history', exact: true }).click();
    await shell.getByRole('button', { name: 'Delete history', exact: true }).click();
    await until(() => shell.evaluate(() => window.orbitBrowser.getHistory().then(n => n.length === 0)));
    assert.equal(await shell.locator('.history-star').count(), 0);
    await shell.locator('[data-history="close"]').click();
    await shell.locator('#cosmos-tab').click();
    assert.equal(await shell.locator('#cosmos').isVisible(), true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    await shell.locator('.star-label').first().waitFor({ state: 'attached' });
    assert.ok(await shell.locator('#cosmos-tab-list button').count() > 0);
    await shell.locator('#history-toggle').click();
    assert.equal(await shell.locator('#cosmos').isVisible(), false);
    assert.equal(await shell.locator('#history').isVisible(), true);
    await shell.locator('#cosmos-tab').click();
    assert.equal(await shell.locator('#history').isVisible(), false);
    assert.equal(await shell.locator('#cosmos').isVisible(), true);
    await shell.screenshot({ path: 'artifacts/jimin-cosmos-restored.png', timeout: 5000 });
  } catch (error) {
    if (shell && !shell.isClosed()) {
      console.error('History at failure:', await history());
      await mkdir('artifacts', { recursive: true }); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
      await shell.screenshot({ path: 'artifacts/history-failure.png', timeout: 5000 }).catch(() => {});
    }
    throw error;
  } finally { if (app) await app.close(); await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true }); }
});
