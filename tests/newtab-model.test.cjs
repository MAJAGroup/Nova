const { test } = require('node:test');
const assert = require('node:assert/strict');

test('procedural galaxy stays bounded and reproducible without external assets', async () => {
  const { createGalaxyParticles, GALAXY_STRIDE } = await import('../ui/newtab/galaxy-model.mjs');
  const data = createGalaxyParticles(180000);
  assert.equal(data.length, 180000 * GALAXY_STRIDE);
  assert.ok(data.byteLength < 6 * 1024 * 1024);
  const populations = new Set();
  for (let i = 0; i < data.length; i += GALAXY_STRIDE) {
    assert.ok(Array.from(data.subarray(i, i + GALAXY_STRIDE)).every(Number.isFinite));
    assert.ok(data[i] >= 0 && data[i] < 1.8);
    assert.ok(Math.abs(data[i + 2]) < 1);
    assert.ok(data[i + 3] > 0 && data[i + 3] <= 1);
    populations.add(data[i + 6]);
  }
  assert.equal(populations.size, 4);
  assert.deepEqual(createGalaxyParticles(20), createGalaxyParticles(20));
  assert.notDeepEqual(createGalaxyParticles(20, 1), createGalaxyParticles(20, 2));
});
