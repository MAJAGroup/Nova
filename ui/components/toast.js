import { el } from "../lib/dom.js";

let timer;

export function showToast(message) {
  const toast = el("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(timer);
  timer = setTimeout(() => toast.classList.remove("visible"), 2600);
}
