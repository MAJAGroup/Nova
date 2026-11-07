"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { NavigationGraph } = require("./navigation-graph");

test("back navigation followed by a new page creates a branch", () => {
  const graph = new NavigationGraph();
  graph.openTab({ tabId: "1", timestamp: 1 });
  const google = graph.recordVisit({ tabId: "1", url: "https://google.com", timestamp: 2 });
  const nice = graph.recordVisit({ tabId: "1", url: "https://nice.com", timestamp: 3 });
  graph.setCurrentVisit({ tabId: "1", visitId: google.id, timestamp: 4, kind: "back" });
  const reddit = graph.recordVisit({ tabId: "1", url: "https://reddit.com", timestamp: 5 });

  const snapshot = graph.getSnapshot();
  assert.equal(graph.getTab("1").currentVisitId, reddit.id);
  assert.equal(nice.parentVisitId, google.id);
  assert.equal(reddit.parentVisitId, google.id);
  assert.deepEqual(snapshot.edges.map(edge => [edge.fromVisitId, edge.toVisitId, edge.kind]), [
    [google.id, nice.id, "navigation"],
    [google.id, reddit.id, "navigation"]
  ]);
  assert.deepEqual(snapshot.events.map(event => event.kind), ["open-tab", "navigate", "navigate", "back", "navigate"]);
  assert.equal(snapshot.events[3].fromVisitId, nice.id);
  assert.equal(snapshot.events[3].toVisitId, google.id);
});

test("revisiting the same URL creates distinct visits and preserves timestamps", () => {
  const graph = new NavigationGraph();
  graph.openTab({ tabId: 7, timestamp: 10 });
  const first = graph.recordVisit({ tabId: 7, url: "https://example.com", timestamp: 11 });
  const second = graph.recordVisit({ tabId: 7, url: "https://example.com", timestamp: 12 });
  assert.notEqual(first.id, second.id);
  assert.equal(first.visitedAt, 11);
  assert.equal(second.visitedAt, 12);
  assert.equal(second.parentVisitId, first.id);
  assert.equal(graph.getSnapshot().visits.length, 2);
});

test("opening a child tab connects its first page to the opener visit", () => {
  const graph = new NavigationGraph();
  graph.openTab({ tabId: "parent", timestamp: 1 });
  const article = graph.recordVisit({ tabId: "parent", url: "https://example.com/article", timestamp: 2 });
  graph.openTab({ tabId: "child", openerTabId: "parent", timestamp: 3 });
  const childPage = graph.recordVisit({ tabId: "child", url: "https://example.com/detail", timestamp: 4 });

  assert.equal(graph.getTab("child").openedFromVisitId, article.id);
  assert.deepEqual(graph.getSnapshot().edges, [{
    id: "edge-1",
    fromVisitId: article.id,
    toVisitId: childPage.id,
    kind: "opened-tab",
    createdAt: 4
  }]);
});

test("closed tab metadata survives a snapshot and a restored tab links to history", () => {
  const graph = new NavigationGraph();
  graph.openTab({ tabId: "old", timestamp: 1 });
  const oldPage = graph.recordVisit({ tabId: "old", url: "https://example.com", timestamp: 2 });
  assert.equal(graph.closeTab({ tabId: "old", timestamp: 3 }), true);
  assert.equal(graph.closeTab({ tabId: "old", timestamp: 4 }), false);
  assert.throws(() => graph.recordVisit({ tabId: "old", url: "https://blocked.example" }), /closed/);

  const saved = graph.getSnapshot();
  const restored = NavigationGraph.fromSnapshot(saved);
  assert.equal(restored.getTab("old").closedAt, 3);
  restored.openTab({ tabId: "new", restoredFromVisitId: oldPage.id, timestamp: 5 });
  const newPage = restored.recordVisit({ tabId: "new", url: "https://example.com", timestamp: 6 });
  assert.deepEqual(restored.getSnapshot().edges.map(edge => edge.kind), ["restored-tab"]);
  assert.equal(restored.getSnapshot().edges[0].toVisitId, newPage.id);
  assert.notEqual(newPage.id, oldPage.id);
  assert.equal(restored.reopenTab({ tabId: "old", timestamp: 7 }), true);
  assert.equal(restored.getTab("old").currentVisitId, oldPage.id);
});

test("snapshots cannot mutate live graph and restored IDs continue uniquely", () => {
  const graph = new NavigationGraph();
  graph.openTab({ tabId: "a", timestamp: 1 });
  graph.recordVisit({ tabId: "a", url: "https://one.example", timestamp: 2 });
  const snapshot = graph.getSnapshot();
  snapshot.tabs[0].visitIds.length = 0;
  snapshot.visits[0].url = "tampered";
  assert.equal(graph.getTab("a").visitIds.length, 1);
  assert.equal(graph.getSnapshot().visits[0].url, "https://one.example");

  const restored = NavigationGraph.fromSnapshot(graph.getSnapshot());
  const next = restored.recordVisit({ tabId: "a", url: "https://two.example", timestamp: 3 });
  assert.equal(next.id, "visit-2");
  assert.equal(restored.getSnapshot().edges[0].id, "edge-1");
});

test("invalid tab and visit relationships are rejected", () => {
  const graph = new NavigationGraph();
  graph.openTab({ tabId: "a", timestamp: 1 });
  graph.openTab({ tabId: "b", timestamp: 1 });
  const a = graph.recordVisit({ tabId: "a", url: "https://a.example", timestamp: 2 });
  assert.throws(() => graph.setCurrentVisit({ tabId: "b", visitId: a.id }), /belong/);
  assert.throws(() => graph.recordVisit({ tabId: "b", url: "https://b.example", fromVisitId: a.id }), /belong/);
  assert.throws(() => graph.openTab({ tabId: "a" }), /already exists/);
  assert.throws(() => graph.recordVisit({ tabId: "b", url: "" }), /url is required/);
});
