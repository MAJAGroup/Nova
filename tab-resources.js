"use strict";

function rendererPids(contents) {
  const ids = new Set();
  if (!contents || contents.isDestroyed()) return ids;
  try { const pid = contents.getOSProcessId(); if (pid > 0) ids.add(pid); } catch { /* Renderer may be swapping. */ }
  try {
    for (const frame of contents.mainFrame.framesInSubtree) {
      try { if (!frame.detached && frame.osProcessId > 0) ids.add(frame.osProcessId); } catch { /* Detached frame. */ }
    }
  } catch { /* Crashed or navigating main frame. */ }
  return ids;
}

function createTabResourceSampler({ getMetrics, now = () => performance.now() }) {
  let previous = new Map();
  return {
    reset() { previous.clear(); },
    sample(tab, tabs) {
      if (!tab || tab.view.webContents.isDestroyed()) return null;
      const contents = tab.view.webContents, time = now(), pids = rendererPids(contents);
      let metrics = []; try { metrics = getMetrics(); } catch { /* OS statistics temporarily unavailable. */ }
      const byPid = new Map(metrics.map(metric => [metric.pid, metric]));
      const next = new Map();
      for (const metric of metrics) next.set(metric.pid, { time, creationTime: metric.creationTime, cumulative: metric.cpu?.cumulativeCPUUsage });
      let memoryBytes = 0, cpuPercent = 0;
      let memoryReady = pids.size > 0, cpuReady = pids.size > 0;
      for (const pid of pids) {
        const metric = byPid.get(pid), before = previous.get(pid), workingSet = metric?.memory?.workingSetSize;
        if (Number.isFinite(workingSet) && workingSet >= 0) memoryBytes += workingSet * 1024;
        else memoryReady = false;
        const cumulative = metric?.cpu?.cumulativeCPUUsage;
        // Use cumulative time so another consumer of getAppMetrics cannot reset
        // our interval. 100% means one logical CPU core, including worker threads.
        if (before && before.creationTime === metric?.creationTime && time > before.time
          && Number.isFinite(cumulative) && Number.isFinite(before.cumulative) && cumulative >= before.cumulative) {
          cpuPercent += (cumulative - before.cumulative) * 100000 / (time - before.time);
        } else if (before && before.creationTime === metric?.creationTime && time > before.time
          && Number.isFinite(metric?.cpu?.percentCPUUsage) && metric.cpu.percentCPUUsage >= 0
          && cumulative === undefined) cpuPercent += metric.cpu.percentCPUUsage;
        else cpuReady = false;
      }
      previous = next;
      let sharedWithTabs = 0;
      for (const other of tabs.values()) {
        if (other.id !== tab.id && [...rendererPids(other.view.webContents)].some(pid => pids.has(pid))) sharedWithTabs++;
      }
      let audio = "unavailable";
      try { audio = contents.isAudioMuted() ? "muted" : contents.isCurrentlyAudible() ? "playing" : "silent"; } catch { /* Closed mid-sample. */ }
      return { id: tab.id, title: tab.title || "New tab", url: tab.url,
        memoryBytes: memoryReady ? memoryBytes : null, cpuPercent: cpuReady ? cpuPercent : null,
        audio, processCount: pids.size, sharedWithTabs,
        status: memoryReady ? "ready" : tab.loading ? "loading" : "unavailable" };
    }
  };
}
module.exports = { rendererPids, createTabResourceSampler };
