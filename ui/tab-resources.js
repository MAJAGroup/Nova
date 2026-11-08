const get = id => document.getElementById(id);
window.novaTabResources.onUpdate(data => {
  get("resource-title").textContent = data.title;
  let domain = "New tab";
  try { const url = new URL(data.url); if (url.protocol !== "file:") domain = url.hostname || "New tab"; } catch { /* A loading tab. */ }
  get("resource-domain").textContent = domain;
  const waiting = data.status === "loading" ? "Loading…" : "Unavailable";
  get("resource-memory").textContent = Number.isFinite(data.memoryBytes) ? `${(data.memoryBytes / 1048576).toFixed(1)} MB` : waiting;
  get("resource-cpu").textContent = Number.isFinite(data.cpuPercent) ? `${data.cpuPercent.toFixed(1)}%` : data.status === "ready" ? "Measuring…" : waiting;
  get("resource-audio").textContent = ({ playing:"Playing", muted:"Muted", silent:"Silent" })[data.audio] || "Unavailable";
  get("resource-audio").dataset.state = data.audio;
  get("resource-scope").textContent = data.sharedWithTabs
    ? `Shared process totals · also used by ${data.sharedWithTabs} other ${data.sharedWithTabs === 1 ? "tab" : "tabs"}`
    : "Page processes · CPU: 100% = one core";
  document.body.dataset.tabId = data.id;
});
document.body.addEventListener("pointerenter", () => window.novaTabResources.pointerInside(true));
document.body.addEventListener("pointerleave", () => window.novaTabResources.pointerInside(false));
document.addEventListener("pointerdown", () => window.novaTabResources.dismiss());
document.addEventListener("keydown", event => { if (event.key === "Escape") window.novaTabResources.dismiss(); });
