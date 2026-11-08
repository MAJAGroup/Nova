const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rendererPids, createTabResourceSampler } = require('../tab-resources');

function tab(id, pids, audio = {}) {
  return { id, title: 'Page ' + id, url:'https://example.test/' + id, loading:false, view:{ webContents:{
    isDestroyed: () => false, getOSProcessId: () => pids[0] || 0,
    mainFrame:{ framesInSubtree:pids.map(osProcessId => ({ osProcessId, detached:false })) },
    isAudioMuted: () => Boolean(audio.muted), isCurrentlyAudible: () => Boolean(audio.playing)
  } } };
}
const metric = (pid, cumulativeCPUUsage, workingSetSize = 1024, creationTime = 1) => ({ pid, creationTime, memory:{workingSetSize}, cpu:{cumulativeCPUUsage} });

test('tab resources sum unique main and iframe renderers, report physical memory and measure CPU over our own interval', () => {
  let time = 0, metrics = [metric(1, 1), metric(2, 2, 2048), metric(99, 100, 99999)];
  const sampler = createTabResourceSampler({ getMetrics: () => metrics, now: () => time });
  const page = tab('one', [1,1,2]), other = tab('two',[2]), tabs = new Map([[page.id,page],[other.id,other]]);
  assert.deepEqual([...rendererPids(page.view.webContents)], [1,2]);
  let data = sampler.sample(page,tabs);
  assert.equal(data.memoryBytes, 3*1048576); assert.equal(data.cpuPercent,null);
  assert.equal(data.processCount,2); assert.equal(data.sharedWithTabs,1);
  time = 1000; metrics = [metric(1, 1.5),metric(2,2.25,2048)]; data = sampler.sample(page,tabs);
  assert.equal(data.cpuPercent,75); assert.equal(data.audio,'silent');
  time = 2000; data = sampler.sample(page,tabs); assert.equal(data.cpuPercent,0);
  sampler.reset(); assert.equal(sampler.sample(page,tabs).cpuPercent,null);
});

test('CPU handles PID reuse, missing processes and invalid readings without inventing zero usage', () => {
  let time = 0, metrics = [metric(1,2)]; const page = tab('one',[1]), tabs = new Map([[page.id,page]]);
  const sampler = createTabResourceSampler({ getMetrics:()=>metrics,now:()=>time });
  sampler.sample(page,tabs);
  time = 1000; metrics = [metric(1,.1,2048,2)]; assert.equal(sampler.sample(page,tabs).cpuPercent,null);
  time = 2000; metrics = []; let data = sampler.sample(page,tabs);
  assert.equal(data.memoryBytes,null); assert.equal(data.cpuPercent,null); assert.equal(data.status,'unavailable');
  page.loading = true; assert.equal(sampler.sample(page,tabs).status,'loading');
  time = 3000; metrics = [metric(1,NaN,-1)]; data = sampler.sample(page,tabs);
  assert.equal(data.memoryBytes,null); assert.equal(data.cpuPercent,null);
  assert.equal(sampler.sample(null,tabs),null);
  page.view.webContents.isDestroyed=()=>true; assert.equal(sampler.sample(page,tabs),null);
});

test('audio distinguishes real playback, muted output, and silence independently of CPU availability', () => {
  const state = {playing:true}, page = tab('one',[1],state);
  const sampler = createTabResourceSampler({getMetrics:()=>[],now:()=>0}), tabs = new Map([[page.id,page]]);
  assert.equal(sampler.sample(page,tabs).audio,'playing');
  state.muted = true; assert.equal(sampler.sample(page,tabs).audio,'muted');
  state.muted = false; state.playing = false; assert.equal(sampler.sample(page,tabs).audio,'silent');
});

test('detached frames are ignored and per-process percentage is a fallback only after a valid baseline', () => {
  let time = 0;
  const page = tab('one',[1]); page.view.webContents.mainFrame.framesInSubtree.push({ detached:true, osProcessId:2 });
  const sampler = createTabResourceSampler({getMetrics:()=>[{pid:1,creationTime:1,cpu:{percentCPUUsage:12},memory:{workingSetSize:0}}],now:()=>time});
  const tabs = new Map([[page.id,page]]);
  assert.equal(sampler.sample(page,tabs).cpuPercent,null);
  time = 1000; const data = sampler.sample(page,tabs);
  assert.equal(data.cpuPercent,12); assert.equal(data.memoryBytes,0); assert.equal(data.processCount,1);
});
