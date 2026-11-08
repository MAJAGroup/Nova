import { el } from "../../lib/dom.js";
import { showToast } from "../toast.js";
import { extractWakeCommand } from "./wake-phrase.mjs";

// Speech detection runs locally; only stretches of speech are sent to
// ElevenLabs. Tune these to trade responsiveness against cost.
const SAMPLE_RATE = 16000;          // what is sent: 16 kHz mono WAV
const PRE_ROLL_MS = 400;            // audio kept from before speech starts, so "hey" isn't clipped
const START_SPEECH_MS = 120;        // loudness needed this long to count as speech
const END_SILENCE_MS = 900;         // this much quiet ends an utterance
const MIN_SPEECH_MS = 450;          // shorter sounds (a cough, a click) are never sent
const MAX_UTTERANCE_MS = 12000;     // longer utterances are cut and sent
const FILLERS = ["One sec.", "Let me check.", "On it.", "Sure, give me a moment.", "Let me look that up.", "Okay, checking."];
const FOLLOW_UP_MS = 8000;          // after a bare "Hey Nova", the next utterance is the command
const MIN_THRESHOLD = 0.012;        // RMS floor for speech

// "Hey Nova" voice activation and spoken replies through ElevenLabs (via
// the main process, which holds the API key). The mic button switches
// listening on and off; while it is off the microphone is closed and nothing
// is sent.
//
// With a Picovoice AccessKey, Porcupine listens for "Hey Nova" on this
// computer and only the utterance after it is sent to ElevenLabs. Without
// one, every utterance is transcribed and those that don't start with the
// wake phrase are discarded.
export function createVoice({ browser, onTranscript, onStateChange = () => {} }) {
  const micButton = el("voice-input");
  let listening = false;
  let stream = null;
  let audioContext = null;
  let processor = null;
  let paused = 0;                   // > 0 while transcribing, answering or speaking
  let state = "off";
  let awaitingUntil = 0;
  let awaitTimer = null;
  let porcupine = null;             // on-device wake word engine, when configured
  let pcm = new Int16Array(0);      // audio waiting to be fed to it
  let startedAwaiting = false;      // the current utterance began after the wake word

  // Detector state.
  let noiseFloor = 0.004;
  let inSpeech = false;
  let loudMs = 0;
  let speechMs = 0;
  let silenceMs = 0;
  let utteranceMs = 0;
  let preRoll = [];
  let frames = [];

  let speakReplies = false;
  let player = null;
  let playback = null;

  function setState(next) {
    state = next;
    for (const name of ["listening", "hearing", "transcribing", "awaiting"]) {
      micButton.classList.toggle(name, next === name);
    }
    micButton.setAttribute("aria-pressed", String(listening));
    micButton.title = listening ? "Voice activation on — say “Hey Nova”. Click to turn off." : "Turn on voice activation (“Hey Nova”)";
    micButton.setAttribute("aria-label", listening ? "Turn off voice activation" : "Turn on voice activation");
    onStateChange(next);
  }

  function idleState() {
    if (!listening) return "off";
    return Date.now() < awaitingUntil ? "awaiting" : "listening";
  }

  function resetDetector() {
    inSpeech = false;
    startedAwaiting = false;
    loudMs = speechMs = silenceMs = utteranceMs = 0;
    preRoll = [];
    frames = [];
  }

  function downsample(input, rate) {
    const ratio = rate / SAMPLE_RATE;
    const length = Math.floor(input.length / ratio);
    const output = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = start; j < end; j++) sum += input[j];
      output[i] = sum / Math.max(1, end - start);
    }
    return output;
  }

  function onAudio(event) {
    if (!listening || paused > 0) {
      if (inSpeech || preRoll.length) resetDetector();
      return;
    }
    const input = event.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    const ms = (input.length / audioContext.sampleRate) * 1000;
    const frame = downsample(input, audioContext.sampleRate);
    const loud = rms > Math.max(MIN_THRESHOLD, noiseFloor * 3);

    // With the on-device engine, nothing is recorded until it hears the wake
    // word; audio goes only to Porcupine.
    if (porcupine && !inSpeech && Date.now() >= awaitingUntil) {
      if (!loud) noiseFloor = noiseFloor * 0.95 + rms * 0.05;
      feedWakeEngine(frame);
      return;
    }

    if (!inSpeech) {
      if (!loud) noiseFloor = noiseFloor * 0.95 + rms * 0.05;
      preRoll.push({ frame, ms });
      let kept = preRoll.reduce((total, entry) => total + entry.ms, 0);
      while (kept > PRE_ROLL_MS + START_SPEECH_MS && preRoll.length > 1) kept -= preRoll.shift().ms;
      loudMs = loud ? loudMs + ms : 0;
      if (loudMs >= START_SPEECH_MS) {
        inSpeech = true;
        frames = preRoll.map((entry) => entry.frame);
        utteranceMs = kept;
        speechMs = loudMs;
        silenceMs = 0;
        preRoll = [];
        startedAwaiting = Date.now() < awaitingUntil;
        setState("hearing");
      }
      return;
    }

    frames.push(frame);
    utteranceMs += ms;
    if (loud) { speechMs += ms; silenceMs = 0; }
    else silenceMs += ms;
    if (silenceMs >= END_SILENCE_MS || utteranceMs >= MAX_UTTERANCE_MS) {
      const clip = frames;
      const enough = speechMs >= MIN_SPEECH_MS;
      const afterWake = startedAwaiting;
      resetDetector();
      if (enough) handleUtterance(clip, { afterWake });
      else setState(idleState());
    }
  }

  function feedWakeEngine(frame) {
    const next = new Int16Array(pcm.length + frame.length);
    next.set(pcm);
    for (let i = 0; i < frame.length; i++) next[pcm.length + i] = Math.max(-32768, Math.min(32767, Math.round(frame[i] * 32767)));
    pcm = next;
    const size = porcupine.frameLength;
    let offset = 0;
    for (; offset + size <= pcm.length; offset += size) {
      porcupine.process(pcm.slice(offset, offset + size)).catch(() => {});
    }
    pcm = pcm.slice(offset);
  }

  function onWakeWord() {
    if (!listening || paused > 0 || Date.now() < awaitingUntil) return;
    pcm = new Int16Array(0);
    resetDetector();
    awaitFollowUp();
    chime();
  }

  function awaitFollowUp() {
    awaitingUntil = Date.now() + FOLLOW_UP_MS;
    clearTimeout(awaitTimer);
    awaitTimer = setTimeout(() => { if (state === "awaiting") setState(idleState()); }, FOLLOW_UP_MS + 50);
    setState("awaiting");
  }

  // A short rising tone: Nova heard its name.
  function chime() {
    if (!audioContext) return;
    const now = audioContext.currentTime;
    const tone = audioContext.createOscillator();
    const gain = audioContext.createGain();
    tone.frequency.setValueAtTime(660, now);
    tone.frequency.exponentialRampToValueAtTime(990, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    tone.connect(gain).connect(audioContext.destination);
    tone.start(now);
    tone.stop(now + 0.26);
  }

  // Loads Porcupine with the "Hey Nova" model the main process trained.
  // Returns "engine", "transcript" (no AccessKey: check transcripts instead)
  // or "failed".
  async function loadWakeEngine() {
    const config = await browser.getWakeWord();
    if (!config.configured) return "transcript";
    if (!config.ok) {
      showToast(config.error || "The wake word engine couldn't start.");
      return "failed";
    }
    try {
      const { Porcupine } = await import("@picovoice/porcupine-web");
      porcupine = await Porcupine.create(
        config.accessKey,
        [{ base64: config.keyword, label: config.label, customWritePath: "nova_hey_nova", forceWrite: true, version: 1 }],
        onWakeWord,
        { base64: config.model, customWritePath: "nova_porcupine_params", forceWrite: false, version: 4 },
        { processErrorCallback: () => {} }
      );
      if (porcupine.sampleRate !== SAMPLE_RATE) throw new Error("Unexpected sample rate");
      return "engine";
    } catch (error) {
      porcupine = null;
      showToast("The wake word engine couldn't start: " + String(error && error.message || error).slice(0, 160));
      return "failed";
    }
  }

  function encodeWav(clip) {
    const length = clip.reduce((total, frame) => total + frame.length, 0);
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);
    const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, "RIFF"); view.setUint32(4, 36 + length * 2, true); text(8, "WAVE");
    text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, "data"); view.setUint32(40, length * 2, true);
    let offset = 44;
    for (const frame of clip) {
      for (let i = 0; i < frame.length; i++, offset += 2) {
        const sample = Math.max(-1, Math.min(1, frame[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      }
    }
    return new Uint8Array(buffer);
  }

  // Transcribes one utterance and works out the request in it, if any.
  // Returns the request, or null when there is nothing to do.
  async function requestFrom(clip, afterWake) {
    const result = await browser.transcribe(encodeWav(clip), "audio/wav");
    if (!result.ok) {
      showToast(result.error);
      if (/key|401|quota/i.test(result.error)) stopListening();
      return null;
    }
    const text = String(result.text || "").trim();
    const wake = extractWakeCommand(text);
    // After the wake word everything is the request (minus a repeated
    // "Hey Nova", which the engine may have heard mid-sentence).
    if (afterWake || (wake === null && Date.now() < awaitingUntil)) return (wake !== null ? wake : text) || null;
    if (wake === "") {
      awaitFollowUp();
      showToast("Yes? I'm listening.");
      return null;
    }
    return wake || null;
  }

  async function handleUtterance(clip, { afterWake = false } = {}) {
    paused++;
    setState("transcribing");
    let command = null;
    try {
      command = await requestFrom(clip, afterWake);
    } catch (_) {
      showToast("Voice input failed.");
    }
    if (!command) {
      paused--;
      return setState(idleState());
    }
    awaitingUntil = 0;
    // Stay deaf while Nova works on the request and reads the reply, so it
    // doesn't transcribe itself.
    try {
      await onTranscript(command);
      if (playback) await playback;
    } finally {
      paused--;
      setState(idleState());
    }
  }

  let starting = false;
  async function startListening() {
    if (starting) return;
    starting = true;
    setState("transcribing");
    try {
      // The first start with a new AccessKey trains the wake word, which
      // takes a few seconds.
      const mode = await loadWakeEngine();
      if (mode === "failed") return setState("off");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (_) {
        releaseWakeEngine();
        showToast("Nova can't use the microphone. Check your system's microphone permissions.");
        return setState("off");
      }
      openAudio();
      showToast(mode === "engine"
        ? "Voice activation on. Say “Hey Nova” — it's detected on this computer."
        : "Voice activation on. Say “Hey Nova” and your request. Without a Picovoice AccessKey, everything said is transcribed to find it.");
    } finally {
      starting = false;
    }
  }

  function releaseWakeEngine() {
    if (porcupine) porcupine.release().catch(() => {});
    porcupine = null;
    pcm = new Int16Array(0);
  }

  function openAudio() {
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(2048, 1, 1);
    const mute = audioContext.createGain();
    mute.gain.value = 0;
    processor.onaudioprocess = onAudio;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(audioContext.destination);
    listening = true;
    resetDetector();
    setState("listening");
  }

  function stopListening() {
    listening = false;
    awaitingUntil = 0;
    clearTimeout(awaitTimer);
    resetDetector();
    releaseWakeEngine();
    if (processor) processor.onaudioprocess = null;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    if (audioContext) audioContext.close().catch(() => {});
    stream = audioContext = processor = null;
    setState("off");
  }

  function toggleListening() {
    if (starting) return;
    if (listening) {
      stopListening();
      showToast("Voice activation off. Nothing is being sent.");
    } else {
      startListening();
    }
  }

  // Spoken lines play one after another: short fillers ("One sec.", "Let me
  // pull up Google Flights") while Nova works, then the reply. Each line is
  // synthesized as soon as it is queued so playback starts without a gap.
  let queue = Promise.resolve();
  let generation = 0;               // bumped by stopSpeaking to drop queued lines
  let queued = 0;
  let lastReplyQueued = 0;
  const fillerAudio = new Map();    // fixed fillers are synthesized once

  function stopSpeaking() {
    generation++;
    queue = Promise.resolve();
    playback = null;
    if (!player) return;
    player.pause();
    URL.revokeObjectURL(player.src);
    player = null;
  }

  function synthesize(text, cache) {
    if (cache && fillerAudio.has(text)) return fillerAudio.get(text);
    const request = browser.speak(text).catch(() => ({ ok: false }));
    if (cache) {
      fillerAudio.set(text, request);
      request.then((result) => { if (!result.ok) fillerAudio.delete(text); });
    }
    return request;
  }

  async function playAudio(bytes) {
    const audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" })));
    player = audio;
    await new Promise((resolve) => {
      audio.onended = audio.onerror = audio.onpause = resolve;
      audio.play().catch(resolve);
    });
    if (player === audio) {
      URL.revokeObjectURL(audio.src);
      player = null;
    }
  }

  // filler: a line said while working. It is skipped if the reply is already
  // queued by the time its turn comes, and never shows an error. cache keeps
  // its audio for next time (for fixed phrases).
  // Resolves when the line has played (or been skipped).
  function play(text, { filler = false, cache = false } = {}) {
    const gen = generation;
    const seq = ++queued;
    if (!filler) lastReplyQueued = seq;
    const audio = synthesize(text, cache);
    const current = queue.then(async () => {
      if (gen !== generation || (filler && lastReplyQueued > seq)) return;
      const result = await audio;
      if (gen !== generation || (filler && lastReplyQueued > seq)) return;
      if (!result.ok) return filler ? undefined : showToast(result.error || "Couldn't play Nova's reply.");
      await playAudio(result.audio);
    }).catch(() => { if (!filler) showToast("Couldn't play Nova's reply."); });
    queue = current;
    playback = current;
    current.finally(() => { if (playback === current) playback = null; });
    return current;
  }

  function toggleSpokenReplies() {
    speakReplies = !speakReplies;
    el("voice-reply").classList.toggle("voice-on", speakReplies);
    el("voice-reply").setAttribute("aria-pressed", String(speakReplies));
    el("voice-reply").setAttribute("aria-label", speakReplies ? "Disable spoken replies" : "Enable spoken replies");
    if (!speakReplies) stopSpeaking();
    showToast(speakReplies ? "Nova will speak its replies." : "Spoken replies are off.");
  }

  micButton.addEventListener("click", toggleListening);
  // A new Picovoice AccessKey was saved: restart so it takes effect.
  document.addEventListener("nova:wake-word-changed", () => {
    if (!listening) return;
    stopListening();
    startListening();
  });
  el("voice-reply").addEventListener("click", toggleSpokenReplies);
  setState("off");

  return {
    toggleListening,
    isListening: () => listening,
    // spoken: the request came from the mic, so answer out loud.
    speak(text, { spoken = false } = {}) {
      if (speakReplies || spoken) play(String(text));
    },
    // A short line while Nova works on a request, said only when the reply
    // will be spoken too. Without text, a random acknowledgement.
    fill(text, { spoken = false } = {}) {
      if (!speakReplies && !spoken) return;
      const fixed = !text;
      play(fixed ? FILLERS[Math.floor(Math.random() * FILLERS.length)] : String(text).slice(0, 160), { filler: true, cache: fixed });
    },
    stopSpeaking
  };
}
