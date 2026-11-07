import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { recordVisit } = require("../desktop-state.js");
test("native journey retains both branches while moving back and forward", () => {
  const tab: {
    journey: { id: string; url: string; parent: string | null }[];
    currentVisit?: string;
    historySlots: Record<string, string>;
  } = { journey: [], historySlots: {} };
  recordVisit(tab, "https://first.example", "First", 0);
  const root = tab.currentVisit;
  recordVisit(tab, "https://second.example", "Second", 1);
  const second = tab.currentVisit;
  recordVisit(tab, "https://first.example", "First", 0);
  assert.equal(tab.currentVisit, root);
  recordVisit(tab, "https://third.example", "Third", 1);
  assert.equal(tab.journey.length, 3);
  assert(tab.journey.some((v) => v.id === second && v.parent === root));
  assert.equal(tab.journey[2].parent, root);
  recordVisit(tab, "https://first.example", "First", 0);
  recordVisit(tab, "https://third.example", "Third", 1);
  assert.equal(tab.journey.length, 3);
});
