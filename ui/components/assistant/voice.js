import { el } from "../../lib/dom.js";
import { showToast } from "../toast.js";

// Microphone input and spoken replies for the assistant composer.
export function createVoice({ onTranscript }) {
  let recognizer = null;
  let speakReplies = false;

  function toggleListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return showToast("Voice input is unavailable in this browser.");
    if (recognizer) {
      recognizer.stop();
      recognizer = null;
      return;
    }
    recognizer = new SpeechRecognition();
    recognizer.lang = navigator.language || "en-US";
    recognizer.interimResults = false;
    recognizer.maxAlternatives = 1;
    el("voice-input").classList.add("recording");
    showToast("Listening…");
    recognizer.onresult = (event) => onTranscript(event.results[0][0].transcript);
    recognizer.onerror = () => showToast("Voice input ended. Check microphone permissions.");
    recognizer.onend = () => {
      el("voice-input").classList.remove("recording");
      recognizer = null;
    };
    recognizer.start();
  }

  function toggleSpokenReplies() {
    speakReplies = !speakReplies;
    el("voice-reply").classList.toggle("voice-on", speakReplies);
    if (!speakReplies && window.speechSynthesis) window.speechSynthesis.cancel();
    showToast(speakReplies ? "Orbit will speak its replies." : "Spoken replies are off.");
  }

  el("voice-input").addEventListener("click", toggleListening);
  el("voice-reply").addEventListener("click", toggleSpokenReplies);

  return {
    speak(text) {
      if (!speakReplies || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(String(text)));
    }
  };
}
