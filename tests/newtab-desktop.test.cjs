const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const { createServer } = require('node:http');
const { mkdtemp, rm, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('local space start page opens on startup and every new tab, animates with the pointer and respects motion preferences', { timeout: 90000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'orbit-newtab-'));
  const server = createServer((_req, res) => res.end('<title>Destination fixture</title><h1>You arrived</h1>'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const destination = `http://127.0.0.1:${server.address().port}/destination`;
  let app, shell;
  const errors = [];
  const until = async predicate => {
    const deadline = Date.now() + 15000;
    while (!await predicate()) { if (Date.now() > deadline) throw new Error('Timed out waiting for start page'); await new Promise(r => setTimeout(r, 40)); }
  };
  const active = () => shell.evaluate(async () => { const data = await window.orbitBrowser.getTabs(); return data.tabs.find(t => t.id === data.activeId); });
  const start = code => app.evaluate(({ webContents }, code) => {
    const contents = webContents.getAllWebContents().find(c => c.getURL().endsWith('/ui/newtab/index.html'));
    if (!contents) throw new Error('No local start page');
    return contents.executeJavaScript(code, true);
  }, code);
  const canvas = () => start('document.getElementById("universe").toDataURL()');
  async function screenshot(name) {
    const data = await app.evaluate(async ({ webContents }) => {
      const contents = webContents.getAllWebContents().find(c => c.getURL().endsWith('/ui/newtab/index.html'));
      return (await contents.capturePage()).toDataURL();
    });
    await mkdir('artifacts', { recursive: true });
    await writeFile(`artifacts/${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
  }
  try {
    app = await _electron.launch({ args: [path.resolve('.')], env: { ...process.env, ORBIT_USER_DATA: profile, ORBIT_START_URL: '', ORBIT_TEST_HIDDEN: '1' } });
    shell = await app.firstWindow(); shell.setDefaultTimeout(10000);
    shell.on('pageerror', error => errors.push(error.message));
    await until(() => shell.evaluate(() => document.documentElement.dataset.orbitReady === 'true'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    await until(async () => (await active())?.isStartPage && !(await active()).loading);
    await until(() => start('document.documentElement.dataset.startReady === "true"'));
    assert.equal((await active()).url, 'orbit://newtab');
    assert.equal((await active()).title, 'New tab');
    assert.equal(await shell.locator('#omnibox').inputValue(), '');
    assert.equal(await shell.locator('#connection-status').getAttribute('data-state'), 'local');
    assert.deepEqual(await shell.evaluate(() => window.orbitBrowser.getHistory()), []);
    assert.equal(await start('typeof window.orbitBrowser'), 'undefined');
    // Freeze the scene, then verify it stays still. Resume and move the native pointer.
    await start('document.getElementById("motion-toggle").click()');
    const still = await canvas();
    await new Promise(r => setTimeout(r, 120));
    assert.equal(await canvas(), still);
    await start('document.getElementById("motion-toggle").click()');
    await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(c => c.getURL().endsWith('/ui/newtab/index.html')).sendInputEvent({ type: 'mouseMove', x: 1100, y: 180 }));
    await until(async () => await canvas() !== still);
    await screenshot('space-start-page');
    await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(c => c.getURL().endsWith('/ui/newtab/index.html')).debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));
    await until(() => start('document.getElementById("motion-toggle").disabled'));
    const reduced = await canvas();
    await new Promise(r => setTimeout(r, 120)); assert.equal(await canvas(), reduced);
    // The form uses the normal native navigation route and retains a real visit.
    await start(`document.getElementById('start-search').value = ${JSON.stringify(destination)}; document.getElementById('search-form').requestSubmit()`);
    await until(async () => (await active()).url === destination && !(await active()).loading);
    const savedTitle = (await shell.evaluate(() => window.orbitBrowser.getHistory()))[0].title;
    assert.equal(savedTitle, 'Destination fixture');
    await shell.evaluate(() => window.orbitBrowser.goBack());
    await until(async () => (await active()).isStartPage && !(await active()).loading);
    assert.equal((await shell.evaluate(() => window.orbitBrowser.getHistory()))[0].title, savedTitle);
    await app.evaluate(({ webContents }) => {
      const contents = webContents.getAllWebContents().find(c => c.getURL().endsWith('/ui/newtab/index.html'));
      contents.once('will-navigate', (event, url) => { contents.testSearchRequest = url; event.preventDefault(); });
    });
    await start(`document.getElementById('start-search').value = 'orbital mechanics'; document.getElementById('search-form').requestSubmit()`);
    await until(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().some(c => c.testSearchRequest === 'https://www.google.com/search?q=orbital%20mechanics')));
    await shell.locator('#new-tab').click();
    await until(async () => (await active()).isStartPage && !(await active()).loading);
    const data = await shell.evaluate(() => window.orbitBrowser.getTabs());
    assert.equal(data.tabs.length, 2);
    const first = data.tabs.find(t => !t.active);
    await shell.evaluate(id => window.orbitBrowser.closeTab(id), first.id);
    await shell.evaluate(id => window.orbitBrowser.closeTab(id), data.activeId);
    await until(async () => (await active()).isStartPage && !(await active()).loading);
    assert.equal((await shell.evaluate(() => window.orbitBrowser.getTabs())).tabs.length, 1);
    assert.equal((await active()).canGoBack, false);
    // Reserve the assistant lane to exercise the narrower layout.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 740));
    await shell.locator('#assistant-reopen').click();
    await until(() => start('innerWidth < 600'));
    assert.equal(await start('document.documentElement.scrollWidth <= innerWidth'), true);
    const formFits = await start('(() => { const r = document.getElementById("search-form").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()');
    assert.equal(formFits, true);
    await screenshot('space-start-page-narrow');
    assert.deepEqual(errors, []);
  } finally {
    if (app) await app.close();
    await new Promise(r => server.close(r)); await rm(profile, { recursive: true, force: true });
  }
});
