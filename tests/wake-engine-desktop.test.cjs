const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { createServer } = require('node:http');
const { mkdtemp, rm, writeFile, readFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// Silence and tone bursts, played once through Chromium's fake microphone:
// the first burst stands in for "Hey Nova", the second for the request.
function speechWav(file) {
  const rate = 16000;
  const parts = [[1.2, false], [1.2, true], [1.0, false], [1.2, true], [2.5, false]];
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

// Stands in for @picovoice/porcupine-web: "detects" the wake word at the end
// of a loud burst of at least 20 frames.
const FAKE_PORCUPINE = `
export class Porcupine {
  static async create(accessKey, keywords, onDetect, model) {
    window.__porcupine = { accessKey, label: keywords[0].label, keyword: keywords[0].base64, modelBytes: model.base64.length, fed: 0, detections: 0 };
    const engine = new Porcupine();
    engine.onDetect = onDetect;
    engine.run = 0;
    return engine;
  }
  get frameLength() { return 512; }
  get sampleRate() { return 16000; }
  async process(pcm) {
    window.__porcupine.fed++;
    let sum = 0;
    for (const value of pcm) sum += value * value;
    if (Math.sqrt(sum / pcm.length) > 500) { this.run++; return; }
    if (this.run >= 20) { window.__porcupine.detections++; this.onDetect({ index: 0, label: 'hey nova' }); }
    this.run = 0;
  }
  async release() { window.__porcupine.released = true; }
}`;

test('with a Picovoice AccessKey, only the request after "Hey Nova" is sent for transcription', { timeout: 90000 }, async () => {
  const server = createServer((req, res) => {
    if (req.url === '/v1/chat/completions') {
      req.resume();
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: '{"action":"answer","text":"Flights to SFO start at $212."}' } }] }));
      });
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<title>Home page</title><h1>Home</h1>');
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const url = 'http://localhost:' + server.address().port;
  const profile = await mkdtemp(path.join(os.tmpdir(), 'nova-wake-'));
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
      args: ['--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + wav + '%noloop', path.resolve('.')],
      env: { ...process.env, NOVA_USER_DATA: profile, NOVA_START_URL: url + '/home', NOVA_TEST_HIDDEN: '1', ELEVENLABS_API_KEY: 'test-key', PICOVOICE_ACCESS_KEY: 'pv-test-key' }
    });
    const shell = await app.firstWindow();
    shell.setDefaultTimeout(15000);
    const errors = [];
    shell.on('pageerror', (error) => errors.push(error.message));
    await until(() => shell.evaluate(() => document.documentElement.dataset.novaReady === 'true'), 'UI');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());

    // Mock Picovoice training and ElevenLabs in the main process, and swap
    // the engine module for the stand-in.
    await app.evaluate(({ session, net }, fake) => {
      const realFetch = globalThis.fetch;
      globalThis.__calls = [];
      globalThis.fetch = async (target, options = {}) => {
        const address = String(target);
        if (address === 'https://rest.picovoice.ai/en/api/ppn') {
          globalThis.__calls.push({ kind: 'train', key: options.headers['x-api-key'], body: JSON.parse(options.body) });
          return new Response(new Uint8Array(64).fill(7));
        }
        if (address.endsWith('/speech-to-text')) {
          globalThis.__calls.push({ kind: 'stt', bytes: options.body.get('file').size });
          return new Response(JSON.stringify({ text: 'Check the prices for a ticket to SFO next week.' }), { headers: { 'Content-Type': 'application/json' } });
        }
        if (address.includes('/text-to-speech/')) {
          globalThis.__calls.push({ kind: 'tts', text: JSON.parse(options.body).text });
          return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), { headers: { 'Content-Type': 'audio/mpeg' } });
        }
        return realFetch(target, options);
      };
      session.defaultSession.protocol.handle('file', (request) => {
        if (request.url.endsWith('/@picovoice/porcupine-web/dist/esm/index.min.js')) {
          return new Response(fake, { headers: { 'Content-Type': 'text/javascript' } });
        }
        return net.fetch(request, { bypassCustomProtocolHandlers: true });
      });
    }, FAKE_PORCUPINE);
    const calls = () => app.evaluate(() => globalThis.__calls);

    await shell.locator('#assistant-reopen').click();
    await shell.evaluate(() => {
      const start = Date.now();
      window.__states = [];
      new MutationObserver(() => window.__states.push((Date.now() - start) + ':' + document.querySelector('#voice-input').className.replace('composer-tool', '').trim()))
        .observe(document.querySelector('#voice-input'), { attributes: true, attributeFilter: ['class'] });
    });
    await shell.locator('#voice-input').click();
    await shell.locator('#voice-input.listening').waitFor();

    try {
      await shell.locator('.assistant-message .message-bubble', { hasText: '$212' }).waitFor({ timeout: 30000 });
    } catch (error) {
      console.error('DEBUG', await shell.locator('#chat-scroll').innerText(), '|', await shell.locator('#toast').innerText(), '|',
        JSON.stringify(await calls()), '|', JSON.stringify(await shell.evaluate(() => window.__porcupine)), errors, await shell.evaluate(() => window.__states.join(' ')));
      throw error;
    }
    assert.deepEqual(await shell.locator('.user-message .message-bubble').allTextContents(), ['Check the prices for a ticket to SFO next week.']);

    // The wake word was trained once from the phrase and kept in the profile.
    const made = await calls();
    const training = made.filter((call) => call.kind === 'train');
    assert.equal(training.length, 1);
    assert.equal(training[0].key, 'pv-test-key');
    assert.deepEqual(training[0].body, { platform: 'wasm', phrase: 'hey nova' });
    assert.equal((await readFile(path.join(profile, 'wake-word', 'hey-nova_wasm.ppn'))).length, 64);

    const engine = await shell.evaluate(() => window.__porcupine);
    assert.equal(engine.accessKey, 'pv-test-key');
    assert.equal(engine.label, 'hey nova');
    assert.equal(engine.keyword, Buffer.from(new Uint8Array(64).fill(7)).toString('base64'));
    assert.ok(engine.modelBytes > 1000000, 'the Porcupine model was passed to the engine');
    assert.ok(engine.fed > 20 && engine.detections === 1);

    // Only the request was transcribed; the wake word burst never left the computer.
    await until(async () => (await calls()).some((call) => call.kind === 'tts'), 'spoken reply');
    const stt = (await calls()).filter((call) => call.kind === 'stt');
    assert.equal(stt.length, 1);
    assert.ok(stt[0].bytes < 16000 * 2 * 3, 'one short utterance');

    // Turning voice off releases the engine. Turning it on again reuses the
    // trained wake word.
    await shell.locator('#voice-input').click();
    await until(() => shell.evaluate(() => window.__porcupine.released === true), 'engine release');
    await shell.locator('#voice-input').click();
    await shell.locator('#voice-input.listening').waitFor();
    assert.equal((await calls()).filter((call) => call.kind === 'train').length, 1);
    await shell.locator('#voice-input').click();
    assert.deepEqual(errors, []);
  } finally {
    if (app) await app.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});
