const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const { createServer } = require('node:http');
const { mkdtemp, rm, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('address and start-page suggestions support web results, history, tab switching, keyboard and offline use', { timeout: 90000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'orbit-suggestions-'));
  const server = createServer((req, res) => res.end(`<title>${req.url === '/archive' ? 'Atlas Archive' : req.url === '/other' ? 'Other fixture' : 'Atlas Observatory'}</title><h1>Atlas fixture</h1>`));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let app, shell, stage = 'startup'; const errors = [];
  const until = async predicate => {
    const end = Date.now() + 12000;
    while (!await predicate()) { if (Date.now() > end) throw Error(`Timed out: ${stage}`); await new Promise(resolve => setTimeout(resolve, 40)); }
  };
  const active = () => shell.evaluate(async () => { const data = await window.orbitBrowser.getTabs(); return data.tabs.find(tab => tab.id === data.activeId); });
  const start = code => app.evaluate(({ BrowserWindow }, code) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children.find(v => v.webContents?.getURL().endsWith('/ui/newtab/index.html') && v.getBounds().width > 0);
    return view?.webContents.executeJavaScript(code, true);
  }, code);
  try {
    app = await _electron.launch({ args: [path.resolve('.')], env: { ...process.env, ORBIT_USER_DATA: profile, ORBIT_START_URL: base + '/atlas', ORBIT_TEST_HIDDEN: '1' } });
    shell = await app.firstWindow(); shell.setDefaultTimeout(10000); shell.on('pageerror', error => errors.push(error.message));
    await shell.waitForFunction(() => document.documentElement.dataset.orbitReady === 'true');
    await app.evaluate(({ BrowserWindow, net, session }, base) => {
      BrowserWindow.getAllWindows()[0].showInactive();
      net.testQueries = []; net.testOffline = false;
      // Keep this integration test deterministic and independent of the network.
      net.fetch = async (url, options) => {
        const q = new URL(url).searchParams.get('q'); net.testQueries.push(q);
        if (net.testOffline) throw Error('offline');
        await new Promise(resolve => setTimeout(resolve, q === 'slow query' ? 700 : 20));
        return { ok: true, text: async () => JSON.stringify([q, [q + ' news', q + ' images', '<img src=x onerror=alert(1)>']]) };
      };
      const browsing = session.fromPartition('persist:orbit');
      browsing.webRequest.onBeforeRequest({ urls: ['https://www.google.com/search*'] }, (details, callback) => {
        browsing.testLastSearch = details.url; callback({ redirectURL: base + '/searched' });
      });
    }, base);
    await until(async () => !(await active()).loading && (await active()).url === base + '/atlas');
    await shell.evaluate(url => window.orbitBrowser.navigate(url), base + '/archive');
    await until(async () => !(await active()).loading && (await active()).url === base + '/archive');
    await shell.evaluate(url => window.orbitBrowser.navigate(url), base + '/other');
    await until(async () => !(await active()).loading && (await active()).url === base + '/other');
    const atlasTab = await shell.evaluate(url => window.orbitBrowser.newTab(url), base + '/atlas');
    await until(async () => !(await active()).loading && (await active()).id === atlasTab);
    await shell.evaluate(() => window.orbitBrowser.newTab());
    await until(async () => (await active()).isStartPage && !(await active()).loading);

    stage = 'local results and native page cover';
    const box = shell.locator('#omnibox'), popup = shell.locator('#address-suggestions');
    await box.fill('Atlas');
    await popup.locator('[data-kind="tab"]').waitFor({ state: 'visible' });
    await popup.locator('[data-source="history"]').waitFor({ state: 'visible' });
    await shell.locator('#browser-suggestion-preview').waitFor({ state: 'visible' });
    assert.equal(await box.getAttribute('aria-expanded'), 'true');
    assert.equal(await popup.locator('[data-kind="tab"]').count(), 1);
    await mkdir('artifacts', { recursive: true });
    await shell.screenshot({ path: 'artifacts/address-suggestions.png' });
    await box.press('ArrowDown'); await box.press('ArrowDown');
    assert.equal(await box.inputValue(), base + '/atlas');
    await box.press('Enter');
    await until(async () => (await active()).id === atlasTab);
    assert.equal((await shell.evaluate(() => window.orbitBrowser.getTabs())).tabs.length, 3);
    assert.equal(await popup.isHidden(), true);
    assert.equal(await shell.locator('#browser-suggestion-preview').isHidden(), true);
    assert.equal(await app.evaluate(({ webContents }, base) => webContents.getAllWebContents().find(c => c.getURL() === base + '/atlas').executeJavaScript('typeof window.orbitSearch'), base), 'undefined');

    stage = 'web autocomplete and escape';
    await box.fill('space');
    await popup.locator('[data-source="google"]').first().waitFor({ state: 'visible' });
    assert.equal(await popup.locator('img').count(), 0);
    assert.ok((await popup.textContent()).includes('<img src=x onerror=alert(1)>'));
    await box.press('ArrowUp');
    assert.equal(await box.inputValue(), '<img src=x onerror=alert(1)>');
    await box.press('Escape');
    assert.equal(await popup.isHidden(), true); assert.equal(await box.inputValue(), base + '/atlas');
    await box.fill('slow query');
    await until(() => app.evaluate(({ net }) => net.testQueries.includes('slow query')));
    await box.fill('fast query');
    await until(async () => (await popup.textContent()).includes('fast query news'));
    await new Promise(resolve => setTimeout(resolve, 750));
    assert.ok(!(await popup.textContent()).includes('slow query'));
    await popup.locator('[data-source="google"]').first().click();
    await until(() => app.evaluate(({ session }) => session.fromPartition('persist:orbit').testLastSearch === 'https://www.google.com/search?q=fast%20query%20news'));
    await until(async () => (await active()).url === base + '/searched' && !(await active()).loading);

    stage = 'history navigation while offline';
    await app.evaluate(({ net }) => { net.testOffline = true; });
    await box.fill('Atlas Archive');
    await popup.locator('[data-source="history"]').waitFor({ state: 'visible' });
    await popup.locator('[data-source="history"]').click();
    await until(async () => (await active()).url === base + '/archive' && !(await active()).loading);
    await box.fill(base + '/direct');
    await popup.locator('[data-source="action"]').waitFor({ state: 'visible' });
    await box.press('Enter');
    await until(async () => (await active()).url === base + '/direct' && !(await active()).loading);

    stage = 'new-tab suggestions';
    const reopenedAtlas = await shell.evaluate(url => window.orbitBrowser.newTab(url), base + '/atlas');
    await until(async () => (await active()).id === reopenedAtlas && !(await active()).loading);
    await shell.evaluate(id => window.orbitBrowser.activateTab(id), atlasTab);
    await shell.locator('#go-home').click();
    await until(async () => (await active()).isStartPage && !(await active()).loading);
    await until(() => start('document.documentElement.dataset.startReady === "true"'));
    assert.equal(await start('typeof window.orbitBrowser'), 'undefined');
    assert.equal(await start('typeof window.orbitSearch.getLocalSuggestions'), 'function');
    await app.evaluate(({ net }) => { net.testOffline = false; });
    await start(`(() => {const i=document.getElementById('start-search');i.focus();i.value='nebula';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until(() => start(`!document.getElementById('start-suggestions').hidden && document.querySelectorAll('#start-suggestions [data-source="google"]').length > 0`));
    assert.equal(await start(`(() => { const r=document.getElementById('start-suggestions').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth;})()`), true);
    await start('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
    const screenshot = await app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find(v => v.webContents?.getURL().endsWith('/ui/newtab/index.html') && v.getBounds().width > 0);
      return (await view.webContents.capturePage()).toDataURL();
    });
    await writeFile('artifacts/newtab-suggestions.png', Buffer.from(screenshot.split(',')[1], 'base64'));
    await start(`document.getElementById('start-search').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));document.getElementById('start-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));`);
    assert.equal(await start(`document.getElementById('start-search').value`), 'nebula');
    assert.equal(await start(`document.getElementById('start-suggestions').hidden`), true);
    await start(`document.getElementById('start-search').value='Atlas';document.getElementById('start-search').dispatchEvent(new Event('input',{bubbles:true}));`);
    await until(() => start(`Boolean(document.querySelector('#start-suggestions [data-kind="tab"]'))`));
    await start(`document.querySelector('#start-suggestions [data-kind="tab"]').click()`);
    await until(async () => (await active()).id === reopenedAtlas);
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error('Suggestion test stage:', stage);
    if (shell && !shell.isClosed()) await shell.screenshot({ path: 'artifacts/suggestions-failure.png' }).catch(() => {});
    throw error;
  } finally {
    if (app) await app.close();
    await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    await rm(profile, { recursive: true, force: true });
  }
});
