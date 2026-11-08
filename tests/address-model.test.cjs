const { test } = require('node:test');
const assert = require('node:assert/strict');
const { connectionStatus } = require('../connection-security');

test('display trimming preserves the destination and discloses HTTP, subdomains, ports and encoded text', async () => {
  const { simplifyAddress } = await import('../ui/lib/url.js');
  const examples = [
    ['https://www.example.com/', 'example.com'],
    ['https://www.example.com/docs/page?q=one%20two&utm_source=test#part', 'example.com/docs/page?q=one%20two&utm_source=test#part'],
    ['http://www.example.com/', 'http://example.com'],
    ['https://accounts.example.com:8443/a%2Fb', 'accounts.example.com:8443/a%2Fb'],
    ['https://www.example.com.evil.test/', 'example.com.evil.test'],
    ['https://example.com@evil.test/', 'evil.test'],
    ['https://xn--pple-43d.com/', 'xn--pple-43d.com'],
    ['https://[::1]:8443/', '[::1]:8443'],
    ['about:blank', 'about:blank'], ['', '']
  ];
  for (const [url, display] of examples) assert.equal(simplifyAddress(url), display);
});

test('a lock requires Chromium proof for this exact document and a currently valid certificate', () => {
  const url = 'https://example.com/';
  const now = Date.now() / 1000;
  const response = { url, securityState: 'secure', securityDetails: { validFrom: now - 60, validTo: now + 3600, issuer: 'Test CA' } };
  assert.equal(connectionStatus(url).state, 'unknown');
  assert.equal(connectionStatus('http://example.com/').state, 'insecure');
  assert.equal(connectionStatus(url, { response }).state, 'secure');
  assert.equal(connectionStatus(url + '#section', { response }).state, 'secure');
  assert.equal(connectionStatus('https://other.test/', { response }).state, 'unknown');
  for (const flags of [{ navigating: true }, { failed: true }, { certificateError: 'net::ERR_CERT_AUTHORITY_INVALID' }, { mixed: true }, { unavailable: true }]) {
    assert.notEqual(connectionStatus(url, { response, ...flags }).state, 'secure');
  }
  for (const securityState of ['insecure', 'neutral', 'unknown', 'insecure-broken']) {
    assert.notEqual(connectionStatus(url, { response: { ...response, securityState } }).state, 'secure');
  }
  for (const dates of [{ validFrom: now - 600, validTo: now - 1 }, { validFrom: now + 600, validTo: now + 3600 }, {}]) {
    assert.notEqual(connectionStatus(url, { response: { ...response, securityDetails: dates } }).state, 'secure');
  }
});

test('connection tracking rejects iframe proof and stale navigation responses, and clears trust on detach', async () => {
  const { EventEmitter } = require('node:events');
  const { trackConnectionSecurity } = require('../connection-security');
  const contents = new EventEmitter(), transport = new EventEmitter();
  let current = '';
  Object.assign(contents, { debugger: transport, getURL: () => current, isDestroyed: () => false });
  Object.assign(transport, { attach() {}, isAttached: () => false,
    sendCommand: async method => method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main' } } } : {} });
  const monitor = trackConnectionSecurity(contents, () => {});
  await monitor.ready;
  const now = Date.now() / 1000;
  const data = { securityState: 'secure', securityDetails: { validFrom: now - 1, validTo: now + 10, issuer: 'Test CA' } };
  const request = (id, url, frameId = 'main') => transport.emit('message', {}, 'Network.requestWillBeSent', { type: 'Document', frameId, requestId: id, request: { url } });
  const respond = (id, url, frameId = 'main') => transport.emit('message', {}, 'Network.responseReceived', { type: 'Document', frameId, requestId: id, response: { url, ...data } });
  const navigate = url => { contents.emit('did-start-navigation', {}, url, false, true); };
  const commit = url => { current = url; contents.emit('did-navigate', {}, url); };
  navigate('https://first.test/');
  request('iframe', 'https://first.test/', 'child'); respond('iframe', 'https://first.test/', 'child');
  commit('https://first.test/');
  assert.equal(monitor.snapshot(current).state, 'unknown');
  navigate('https://first.test/'); request('first', 'https://first.test/'); respond('first', 'https://first.test/');
  assert.equal(monitor.snapshot(current).state, 'checking');
  commit('https://first.test/');
  assert.equal(monitor.snapshot(current).state, 'secure');
  navigate('https://second.test/'); request('second', 'https://second.test/'); respond('first', 'https://first.test/');
  commit('https://second.test/');
  assert.equal(monitor.snapshot(current).state, 'unknown');
  respond('second', 'https://second.test/');
  assert.equal(monitor.snapshot(current).state, 'secure');
  transport.emit('message', {}, 'Network.requestWillBeSent', { type: 'Image', frameId: 'main', requestId: 'blocked', request: { mixedContentType: 'optionally-blockable' } });
  transport.emit('message', {}, 'Network.loadingFailed', { requestId: 'blocked' });
  assert.equal(monitor.snapshot(current).state, 'secure');
  transport.emit('message', {}, 'Network.responseReceived', { type: 'Image', frameId: 'main', requestId: 'loaded', response: { url: 'http://insecure.test/image' } });
  assert.equal(monitor.snapshot(current).state, 'insecure');
  transport.emit('detach');
  assert.equal(monitor.snapshot(current).state, 'unknown');
  contents.emit('destroyed');
});
