const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const { createServer } = require('node:http');
const { createServer: createHttpsServer } = require('node:https');
const { execFileSync } = require('node:child_process');
const { mkdtemp, readFile, writeFile, rm, mkdir } = require('node:fs/promises');
const { X509Certificate } = require('node:crypto');
const path = require('node:path');
const os = require('node:os');

// A temporary CA is trusted only inside this test's disposable Electron session.
// It is never installed on the machine or enabled by application code.
test('address bar trims only its display and tracks verified TLS, mixed content, failures and tab switches', { timeout: 90000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'orbit-address-'));
  const servers = []; let app, shell;
  const errors = [];
  let diagnostics = "", stage = "startup";
  const openssl = args => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  const until = async check => {
    const deadline = Date.now() + 15000;
    while (!await check()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for address state');
      await new Promise(r => setTimeout(r, 40));
    }
  };
  async function listen(server) {
    servers.push(server);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    return server.address().port;
  }
  try {
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=ORBIT temporary test CA']);
    openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=127.0.0.1']);
    await writeFile(path.join(dir, 'extensions.cnf'), 'subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n');
    openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '1', '-extfile', 'extensions.cnf']);
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'bad.key', '-out', 'bad.pem', '-days', '1', '-subj', '/CN=untrusted.test']);
    const cert = await readFile(path.join(dir, 'server.pem'), 'utf8');
    const ca = await readFile(path.join(dir, 'ca.pem'), 'utf8');
    const leaf = new X509Certificate(cert);
    assert.ok(leaf.verify(new X509Certificate(ca).publicKey) && leaf.checkIP('127.0.0.1'));
    const httpPort = await listen(createServer((req, res) => {
      if (req.url === '/pixel.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>'); return; }
      res.end('<title>HTTP fixture</title><h1>HTTP fixture</h1>');
    }));
    const httpUrl = `http://127.0.0.1:${httpPort}`;
    const tlsPort = await listen(createHttpsServer({ key: await readFile(path.join(dir, 'server.key')), cert }, (req, res) => {
      if (req.url === '/redirect') { res.writeHead(302, { Location: httpUrl + '/redirected' }); res.end(); return; }
      const mixed = req.url.startsWith('/mixed') ? `<img src="${httpUrl}/pixel.svg">` : '';
      res.end(`<title>TLS fixture</title><h1>TLS fixture</h1>${mixed}`);
    }));
    const badPort = await listen(createHttpsServer({ key: await readFile(path.join(dir, 'bad.key')), cert: await readFile(path.join(dir, 'bad.pem')) }, (_req, res) => res.end('Must not load')));
    const tlsUrl = `https://127.0.0.1:${tlsPort}`;
    app = await _electron.launch({ args: [path.resolve('.')], env: { ...process.env, ORBIT_USER_DATA: path.join(dir, 'profile'), ORBIT_START_URL: httpUrl, ORBIT_TEST_HIDDEN: '1' } });
    app.process().stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-8000); });
    app.process().on('exit', (code, signal) => { diagnostics += `\nElectron exit: ${code} ${signal}`; });
    shell = await app.firstWindow(); shell.setDefaultTimeout(10000);
    shell.on('pageerror', error => errors.push(error.message));
    await shell.waitForFunction(() => document.documentElement.dataset.orbitReady === 'true');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    await app.evaluate(({ session }, trustedCertificate) => {
      session.fromPartition('persist:orbit').setCertificateVerifyProc((request, callback) => {
        const now = Date.now() / 1000;
        const trustedFixture = request.hostname === '127.0.0.1'
          && request.certificate.data.trim() === trustedCertificate.trim()
          && request.certificate.validStart <= now && now < request.certificate.validExpiry;
        callback(trustedFixture ? 0 : -3);
      });
    }, cert);
    const active = () => shell.evaluate(async () => { const p = await window.orbitBrowser.getTabs(); return p.tabs.find(t => t.id === p.activeId); });
    const navigate = url => shell.evaluate(url => window.orbitBrowser.navigate(url), url);
    const state = () => shell.locator('#connection-status').getAttribute('data-state');
    await until(async () => (await active())?.url === httpUrl + '/' && await state() === 'insecure');
    const httpTabId = (await active()).id;
    stage = "verified TLS";
    const fullUrl = tlsUrl + '/docs/page?q=one%20two&utm_source=keep#section';
    const httpsTabId = await shell.evaluate(url => window.orbitBrowser.newTab(url), fullUrl);
    await until(async () => (await active())?.url === fullUrl && await state() === 'secure');
    const box = shell.locator('#omnibox');
    assert.equal(await box.inputValue(), fullUrl.replace('https://', ''));
    assert.match(await shell.locator('#connection-status').getAttribute('title'), /Certificate is valid/);
    await box.click();
    assert.equal(await box.inputValue(), fullUrl);
    assert.equal(await box.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd)), fullUrl);
    await box.fill('https://somewhere-else.test/');
    assert.notEqual(await state(), 'secure');
    await box.press('Escape');
    assert.equal(await box.inputValue(), fullUrl.replace('https://', ''));
    await until(async () => await state() === 'secure');
    await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(c => c.getURL() === url).executeJavaScript('history.pushState({}, "", "#changed")'), fullUrl);
    await until(async () => (await active()).url.endsWith('#changed') && await state() === 'secure');
    stage = "switch to HTTP";
    await shell.evaluate(id => window.orbitBrowser.activateTab(id), httpTabId);
    await until(async () => await state() === 'insecure');
    await shell.evaluate(id => window.orbitBrowser.activateTab(id), httpsTabId);
    await until(async () => await state() === 'secure');
    stage = 'mixed content';
    await navigate(tlsUrl + '/mixed');
    await until(async () => !(await active()).loading && (await active()).url === tlsUrl + '/mixed');
    await until(async () => await state() === 'insecure');
    await navigate(tlsUrl + '/redirect');
    await until(async () => (await active()).url === httpUrl + '/redirected' && await state() === 'insecure');
    await navigate(`https://127.0.0.1:${badPort}/`);
    await until(async () => await state() === 'error');
    assert.notEqual((await active()).connection.state, 'secure');
    await navigate(tlsUrl + '/recovered');
    await until(async () => (await active()).url === tlsUrl + '/recovered' && await state() === 'secure');
    await shell.locator('#cosmos-tab').click();
    await mkdir('artifacts', { recursive: true });
    await shell.screenshot({ path: 'artifacts/secure-address-bar.png' });
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error(stage, diagnostics);
    if (shell && !shell.isClosed()) {
      console.error('Address status:', await shell.locator('#connection-status').getAttribute('title').catch(() => 'unavailable'));
      await mkdir('artifacts', { recursive: true });
      await shell.screenshot({ path: 'artifacts/address-failure.png', timeout: 5000 }).catch(() => {});
    }
    throw error;
  } finally {
    if (app) await app.close();
    await Promise.all(servers.map(server => new Promise(r => { server.closeAllConnections(); server.close(r); })));
    await rm(dir, { recursive: true, force: true });
  }
});
