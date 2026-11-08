"use strict";

// The URL scheme alone is not proof of a valid certificate. Only a committed
// main-frame response reported as secure by Chromium can earn the lock.
function connectionStatus(url, { response, navigating = false, failed = false, certificateError = "", mixed = false, unavailable = false } = {}) {
  let address;
  try { address = new URL(url); } catch { return { state: "unknown", message: "No connection information" }; }
  if (navigating) return { state: "checking", message: "Checking connection security…" };
  if (certificateError) return { state: "error", message: `Certificate could not be verified (${certificateError}). The connection was blocked.` };
  if (failed) return { state: "error", message: "This page could not be loaded securely" };
  if (address.protocol === "http:") return { state: "insecure", message: "Not secure — this HTTP connection is not encrypted" };
  if (address.protocol !== "https:") return { state: "unknown", message: "No connection information" };
  if (mixed) return { state: "insecure", message: "Not secure — this page loaded insecure content" };
  const certificate = response?.securityDetails;
  const now = Date.now() / 1000;
  let responseUrl;
  try { responseUrl = new URL(response?.url); responseUrl.hash = ""; } catch { /* No verified response yet. */ }
  address.hash = ""; // URL fragments are not sent over the connection.
  if (unavailable || responseUrl?.href !== address.href || !certificate) return { state: "unknown", message: "Connection security has not been verified" };
  if (response.securityState !== "secure" || !(certificate.validFrom <= now && now < certificate.validTo)) {
    return { state: "insecure", message: "Not secure — the connection or certificate is not valid" };
  }
  return { state: "secure", message: `Connection is secure. Certificate is valid.\nIssued by: ${certificate.issuer}\nExpires: ${new Date(certificate.validTo * 1000).toLocaleString()}` };
}

function trackConnectionSecurity(contents, onChange, { verificationDisabled = false } = {}) {
  let mainFrameId, mainRequestId, response, navigating = false, failed = false;
  let certificateError = "", mixed = false, unavailable = true, expiryTimer;
  let committedUrl = contents.getURL();
  let navigationUrl = committedUrl;
  const mixedRequests = new Set();
  let earlyMessages = [];
  const notify = () => { if (!contents.isDestroyed()) onChange(); };
  function watchExpiry() {
    clearTimeout(expiryTimer);
    const remaining = response?.securityDetails?.validTo * 1000 - Date.now();
    if (remaining > 0) {
      expiryTimer = setTimeout(() => { notify(); watchExpiry(); }, Math.min(remaining + 1, 2147483647));
      expiryTimer.unref?.();
    }
  }
  function reset() {
    response = undefined; failed = false; certificateError = ""; mixed = false;
    mainRequestId = undefined; mixedRequests.clear(); clearTimeout(expiryTimer);
  }
  contents.on("did-start-navigation", (_event, url, inPlace, isMainFrame) => {
    if (!isMainFrame || inPlace) return;
    reset(); navigationUrl = url; navigating = true; notify();
  });
  contents.on("did-redirect-navigation", (_event, url, _inPlace, isMainFrame) => {
    if (isMainFrame) navigationUrl = url;
  });
  contents.on("did-navigate", (_event, url) => {
    committedUrl = url; navigationUrl = url; navigating = false;
    if (response) { failed = false; certificateError = ""; }
    notify();
  });
  contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (!isMainFrame) return;
    // A same-document URL change retains the same verified connection.
    if (response && new URL(url).origin === new URL(committedUrl).origin) response.url = url;
    committedUrl = url; notify();
  });
  function loadFailed(_event, code, _description, url, isMainFrame) {
    if (!isMainFrame || code === -3 || url !== navigationUrl) return;
    failed = true; navigating = false; response = undefined; notify();
  }
  contents.on("did-fail-load", loadFailed);
  contents.on("did-fail-provisional-load", loadFailed);
  contents.on("did-stop-loading", () => { navigating = false; notify(); });
  contents.on("certificate-error", (_event, url, error, _certificate, _callback, isMainFrame) => {
    // Observe only. Electron's default rejection remains in force.
    if (isMainFrame && url === navigationUrl) { certificateError = error; navigating = false; response = undefined; notify(); }
  });
  contents.on("render-process-gone", () => { reset(); failed = true; navigating = false; notify(); });
  function handleMessage(method, params) {
    if (method === "Network.requestWillBeSent") {
      if (params.type === "Document" && params.frameId === mainFrameId) {
        mainRequestId = params.requestId;
      } else if (params.request.mixedContentType && params.request.mixedContentType !== "none") {
        mixedRequests.add(params.requestId);
      }
    }
    if (method === "Network.responseReceived") {
      if (params.type === "Document" && params.frameId === mainFrameId && params.requestId === mainRequestId) {
        // Keep only connection metadata; do not retain bodies, cookies or headers.
        response = { url: params.response.url, securityState: params.response.securityState, securityDetails: params.response.securityDetails };
        watchExpiry(); notify();
      } else if (mixedRequests.has(params.requestId) || (params.response.url.startsWith("http:") && (response?.url || committedUrl).startsWith("https:"))) {
        mixed = true; notify();
      }
    }
    if (method === "Network.loadingFinished" || method === "Network.loadingFailed") mixedRequests.delete(params.requestId);
  }
  contents.debugger.on("message", (_event, method, params) => {
    if (!mainFrameId) {
      // Protocol commands can finish after navigation starts. Buffer only the
      // small metadata needed to attribute early responses to the main frame.
      if (earlyMessages.length >= 512) return;
      const { type, frameId, requestId } = params;
      if (method === "Network.requestWillBeSent") earlyMessages.push([method, { type, frameId, requestId, request: { url: params.request.url, mixedContentType: params.request.mixedContentType } }]);
      if (method === "Network.responseReceived") earlyMessages.push([method, { type, frameId, requestId, response: { url: params.response.url, securityState: params.response.securityState, securityDetails: params.response.securityDetails } }]);
      if (method === "Network.loadingFinished" || method === "Network.loadingFailed") earlyMessages.push([method, { requestId }]);
      return;
    }
    handleMessage(method, params);
  });
  contents.debugger.on("detach", () => { unavailable = true; mainFrameId = undefined; earlyMessages = []; reset(); notify(); });
  async function attach() {
    if (contents.isDestroyed() || contents.debugger.isAttached()) return;
    try {
      contents.debugger.attach("1.3");
      // Start both commands without delaying the page's own navigation.
      const [, { frameTree }] = await Promise.all([
        contents.debugger.sendCommand("Network.enable"),
        contents.debugger.sendCommand("Page.getFrameTree")
      ]);
      mainFrameId = frameTree.frame.id;
      unavailable = verificationDisabled;
      for (const [method, params] of earlyMessages) handleMessage(method, params);
      earlyMessages = []; notify();
    } catch { unavailable = true; notify(); }
  }
  contents.on("devtools-closed", () => {
    // Reattach after DevTools releases the transport. No lock until fresh evidence.
    void attach();
  });
  contents.on("destroyed", () => clearTimeout(expiryTimer));
  const ready = attach();
  return {
    ready,
    snapshot: url => connectionStatus(url, { response, navigating, failed, certificateError, mixed, unavailable })
  };
}
module.exports = { connectionStatus, trackConnectionSecurity };
