const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { createServer } = require('node:http');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// A WAV of "speech" bursts and silence, fed to Chromium's fake microphone.
// Each burst is one utterance for the speech detector.
function speechWav(file) {
  const rate = 16000;
  const parts = [[1.2, false], [1.2, true], [1.6, false], [1.2, true], [1.6, false]];
  const total = parts.reduce((sum, [seconds]) => sum + Math.round(seconds * rate), 0);
  const buffer = Buffer.alloc(44 + total * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + total * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(total * 2, 40);
  let offset = 44;
  for (const [seconds, voiced] of parts) {
    for (let i = 0; i < Math.round(seconds * rate); i++, offset += 2) {
      const t = i / rate;
      const sample = voiced ? 0.35 * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) : 0;
      buffer.writeInt16LE(Math.round(sample * 0x7fff), offset);
    }
  }
  return writeFile(file, buffer);
}

// "Hey Nova" voice activation → ElevenLabs (mocked in the main process) →
// agent opens a side tab → reply is spoken. Speech without the wake phrase is
// ignored, and switching voice off stops all transcription. The chat endpoint
// is a scripted local server.
test('a spoken request opens a side tab beside the page and answers from it', { timeout: 120000 }, async () => {
  const chatRequests = [];
  const server = createServer((req, res) => {
    if (req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const { messages } = JSON.parse(body);
        chatRequests.push(messages);
        const last = messages.at(-1).content;
        const content = /United \$212/.test(last)
          ? '{"action":"answer","text":"The cheapest flight to SFO next week is $212 on United."}'
          : JSON.stringify({ action: 'open', url: url + '/flights?q=' + encodeURIComponent('flights to SFO'), say: 'Checking Google Flights' });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url.startsWith('/flights')) {
      // Results appear after load, like a script-rendered results page.
      res.end('<title>Flights to SFO</title><div id="r">Searching…</div><script>setTimeout(() => { document.getElementById("r").textContent = "United $212 · Alaska $240"; }, 400)</script>');
    } else {
      res.end('<title>Home page</title><h1>Home</h1>');
    }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const url = 'http://localhost:' + server.address().port;
  const profile = await mkdtemp(path.join(os.tmpdir(), 'nova-agent-'));
  const wav = path.join(profile, 'speech.wav');
  await speechWav(wav);
  await writeFile(path.join(profile, 'nova-settings.json'), JSON.stringify({ bullsaiUrl: url + '/v1/chat/completions', model: 'test' }));
  let app;
  const until = async (check, label) => {
    const end = Date.now() + 20000;
    while (!await check()) {
      if (Date.now() > end) throw new Error('Timed out waiting for ' + label);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  try {
    app = await electron.launch({
      args: ['--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + wav, path.resolve('.')],
      env: { ...process.env, NOVA_USER_DATA: profile, NOVA_START_URL: url + '/home', NOVA_TEST_HIDDEN: '1', ELEVENLABS_API_KEY: 'test-key', BULLSAI_API_KEY: 'test-chat-key' }
    });
    const shell = await app.firstWindow();
    shell.setDefaultTimeout(15000);
    const errors = [];
    shell.on('pageerror', (error) => errors.push(error.message));
    await until(() => shell.evaluate(() => document.documentElement.dataset.novaReady === 'true'), 'UI');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    const tabsNow = () => shell.evaluate(() => window.novaBrowser.getTabs());
    await until(async () => (await tabsNow()).tabs.some((tab) => tab.title === 'Home page' && !tab.loading), 'home page');

    // Mock ElevenLabs inside the main process. The first utterance isn't
    // addressed to Nova, the second is; later ones are background talk.
    await app.evaluate(() => {
      const realFetch = globalThis.fetch;
      globalThis.__eleven = [];
      const heard = ['So anyway, I was saying the train is cheaper.', 'Hey Nova, can you check the prices for a ticket to SFO next week?'];
      globalThis.fetch = async (target, options = {}) => {
        const address = String(target);
        if (!address.startsWith('https://api.elevenlabs.io/')) return realFetch(target, options);
        const call = { url: address, key: options.headers['xi-api-key'] };
        if (address.endsWith('/speech-to-text')) {
          const file = options.body.get('file');
          call.model = options.body.get('model_id');
          call.bytes = file.size;
          call.type = file.type;
          globalThis.__eleven.push(call);
          const text = heard.shift() || 'Background chatter.';
          return new Response(JSON.stringify({ text }), { headers: { 'Content-Type': 'application/json' } });
        }
        call.body = JSON.parse(options.body);
        globalThis.__eleven.push(call);
        return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), { headers: { 'Content-Type': 'audio/mpeg' } });
      };
    });

    await shell.locator('#assistant-reopen').click();
    await shell.locator('#assistant.expanded').waitFor();
    assert.equal(await shell.locator('#voice-input').getAttribute('aria-pressed'), 'false');
    await shell.locator('#voice-input').click();
    await shell.locator('#voice-input.listening, #voice-input.hearing').waitFor();
    assert.equal(await shell.locator('#voice-input').getAttribute('aria-pressed'), 'true');

    try {
      await shell.locator('.assistant-message .message-bubble', { hasText: '$212 on United' }).waitFor({ timeout: 30000 });
    } catch (error) {
      console.error('DEBUG chat:', await shell.locator('#chat-scroll').innerText(), '| toast:', await shell.locator('#toast').innerText(),
        '| status:', await shell.locator('#ai-status').innerText(), '| chat requests:', chatRequests.length,
        '| eleven:', JSON.stringify(await app.evaluate(() => globalThis.__eleven)), '| errors:', errors);
      throw error;
    }
    // Only the addressed request reached the chat, without the wake phrase.
    assert.deepEqual(await shell.locator('.user-message .message-bubble').allTextContents(), ['can you check the prices for a ticket to SFO next week?']);

    const calls = await app.evaluate(() => globalThis.__eleven);
    assert.ok(calls.filter((call) => call.url.endsWith('/speech-to-text')).length >= 2, 'the unaddressed utterance was transcribed and dropped');
    const stt = calls.find((call) => call.url.endsWith('/speech-to-text'));
    assert.ok(stt && stt.bytes > 16000, 'an utterance was sent for transcription');
    assert.equal(stt.type, 'audio/wav');
    assert.ok(stt.bytes < 16000 * 2 * 4, 'only the utterance is sent, not continuous audio');
    assert.equal(stt.key, 'test-key');
    assert.equal(stt.model, 'scribe_v1');
    const spoken = async () => (await app.evaluate(() => globalThis.__eleven)).filter((call) => call.url.includes('/text-to-speech/')).map((call) => call.body.text);
    await until(async () => (await spoken()).some((text) => /\$212 on United/.test(text)), 'spoken reply');
    // While it works, Nova acknowledges the request and says what it's
    // opening, then speaks the answer.
    const lines = await spoken();
    assert.ok(lines.length >= 3, 'filler, progress and reply were spoken: ' + JSON.stringify(lines));
    assert.match(lines[0], /^(One sec\.|Let me check\.|On it\.|Sure, give me a moment\.|Let me look that up\.|Okay, checking\.)$/);
    assert.equal(lines.indexOf('Checking Google Flights'), 1);
    assert.match(lines.at(-1), /\$212 on United/);

    // The model saw today's date, and the page text after it rendered.
    assert.match(chatRequests[0][0].content, /Today is \d{4}-\d{2}-\d{2}/);
    assert.match(chatRequests[1].at(-1).content, /United \$212/);

    // The flights page is a side tab next to the still-active home page.
    const payload = await tabsNow();
    const side = payload.tabs.find((tab) => tab.id === payload.sideId);
    assert.ok(side, 'side tab exists');
    assert.match(side.url, /\/flights/);
    assert.equal(payload.tabs.find((tab) => tab.active).title, 'Home page');
    await shell.locator('#side-pane:not([hidden])').waitFor();
    assert.equal(await shell.locator('#side-pane-title').textContent(), 'Flights to SFO');
    assert.equal(await shell.locator('.browser-tab.side').count(), 1);

    const views = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .filter((view) => view.getVisible()).map((view) => ({ ...view.getBounds(), url: view.webContents.getURL() })));
    assert.equal(views.length, 2, 'main page and side tab are both visible');
    const homeView = views.find((view) => view.url.endsWith('/home'));
    const sideView = views.find((view) => view.url.includes('/flights'));
    assert.ok(homeView.x + homeView.width <= sideView.x, 'side tab sits to the right of the page');
    const assistantBox = await shell.locator('#assistant').boundingBox();
    assert.ok(sideView.x + sideView.width <= Math.ceil(assistantBox.x) + 1, 'side tab stays left of the assistant');

    // Making it the main tab ends the split.
    await shell.locator('#side-pane-promote').click();
    await until(async () => { const next = await tabsNow(); return !next.sideId && next.tabs.find((tab) => tab.active).url.includes('/flights'); }, 'promotion');
    await shell.locator('#side-pane').waitFor({ state: 'hidden' });

    // Turning voice off closes the mic: the looping audio is no longer sent.
    await shell.locator('#voice-input').click();
    assert.equal(await shell.locator('#voice-input').getAttribute('aria-pressed'), 'false');
    const sttCount = async () => (await app.evaluate(() => globalThis.__eleven)).filter((call) => call.url.endsWith('/speech-to-text')).length;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const before = await sttCount();
    await new Promise((resolve) => setTimeout(resolve, 5000));
    assert.equal(await sttCount(), before, 'no transcription while voice is off');
    assert.equal(await shell.evaluate(() => document.querySelector('#voice-input').className.includes('listening')), false);
    assert.deepEqual(errors, []);
  } finally {
    if (app) await app.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});
