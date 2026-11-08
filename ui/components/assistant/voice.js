import { el } from "../../lib/dom.js";
import { showToast } from "../toast.js";

const MAX_RECORDING_MS = 30000;

// Push-to-talk and spoken replies through ElevenLabs (via the main process,
// which holds the API key). Click the mic to start, click again to send.
// Replies to spoken requests are always read aloud; the speaker toggle reads
// typed ones too.
export function createVoice({ browser, onTranscript, onStateChange = () => {} }) {
  const micButton = el("voice-input");
  let recorder = null;
  let stream = null;
  let chunks = [];
  let stopTimer = null;
  let speakReplies = false;
  let player = null;
  let busy = false;

  function setState(state) {
    micButton.classList.toggle("recording", state === "recording");
    micButton.classList.toggle("transcribing", state === "transcribing");
    micButton.setAttribute("aria-pressed", String(state === "recording"));
    micButton.title = state === "recording" ? "Stop and send" : "Speak to Orbit";
    micButton.setAttribute("aria-label", state === "recording" ? "Stop voice input and send" : "Start voice input");
    onStateChange(state);
  }

  function releaseMic() {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  async function startRecording() {
    stopSpeaking();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (_) {
      showToast("Orbit can't use the microphone. Check your system's microphone permissions.");
      return;
    }
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => finishRecording(recorder.mimeType || mimeType || "audio/webm");
    recorder.start();
    stopTimer = setTimeout(stopRecording, MAX_RECORDING_MS);
    setState("recording");
  }

  function stopRecording() {
    clearTimeout(stopTimer);
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  async function finishRecording(mimeType) {
    releaseMic();
    recorder = null;
    const blob = new Blob(chunks, { type: mimeType });
    chunks = [];
    if (blob.size < 1000) {
      setState("idle");
      return showToast("I didn't catch that. Click the mic, speak, then click it again.");
    }
    busy = true;
    setState("transcribing");
    try {
      const result = await browser.transcribe(new Uint8Array(await blob.arrayBuffer()), mimeType);
      if (!result.ok) return showToast(result.error);
      if (!result.text) return showToast("I didn't catch that. Try again a little closer to the mic.");
      onTranscript(result.text);
    } catch (_) {
      showToast("Voice input failed. Try again.");
    } finally {
      busy = false;
      setState("idle");
    }
  }

  function toggleListening() {
    if (busy) return;
    if (recorder) stopRecording();
    else startRecording();
  }

  function stopSpeaking() {
    if (!player) return;
    player.pause();
    URL.revokeObjectURL(player.src);
    player = null;
  }

  async function play(text) {
    stopSpeaking();
    try {
      const result = await browser.speak(text);
      if (!result.ok) return showToast(result.error);
      const audio = new Audio(URL.createObjectURL(new Blob([result.audio], { type: "audio/mpeg" })));
      player = audio;
      audio.onended = () => { if (player === audio) stopSpeaking(); };
      await audio.play();
    } catch (_) {
      showToast("Couldn't play Orbit's reply.");
    }
  }

  function toggleSpokenReplies() {
    speakReplies = !speakReplies;
    el("voice-reply").classList.toggle("voice-on", speakReplies);
    el("voice-reply").setAttribute("aria-pressed", String(speakReplies));
    el("voice-reply").setAttribute("aria-label", speakReplies ? "Disable spoken replies" : "Enable spoken replies");
    if (!speakReplies) stopSpeaking();
    showToast(speakReplies ? "Orbit will speak its replies." : "Spoken replies are off.");
  }

  micButton.addEventListener("click", toggleListening);
  el("voice-reply").addEventListener("click", toggleSpokenReplies);

  return {
    toggleListening,
    // spoken: the request came from the mic, so answer out loud.
    speak(text, { spoken = false } = {}) {
      if (speakReplies || spoken) play(String(text));
    },
    stopSpeaking
  };
}
