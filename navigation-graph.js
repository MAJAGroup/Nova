"use strict";

// The graph records browser state, not browser actions. A visit is created only
// when a new page is visited; moving through existing history changes the cursor.
const VERSION = 1;

function requiredId(value, label) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return String(value);
}

function optionalId(value) {
  return value === undefined || value === null ? null : requiredId(value, "id");
}

function timeValue(value) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError("timestamp must be a non-negative number");
  return value;
}

function copy(value) {
  return { ...value };
}

class NavigationGraph {
  constructor({ now = Date.now } = {}) {
    if (typeof now !== "function") throw new TypeError("now must be a function");
    this.now = now;
    this.tabs = new Map();
    this.visits = new Map();
    this.edges = [];
    this.events = [];
    this.nextVisitNumber = 1;
    this.nextEdgeNumber = 1;
    this.nextEventNumber = 1;
  }

  _timestamp(value) {
    return timeValue(value === undefined ? this.now() : value);
  }

  _tab(tabId) {
    const tab = this.tabs.get(requiredId(tabId, "tabId"));
    if (!tab) throw new RangeError(`unknown tab: ${tabId}`);
    return tab;
  }

  _visit(visitId) {
    const visit = this.visits.get(requiredId(visitId, "visitId"));
    if (!visit) throw new RangeError(`unknown visit: ${visitId}`);
    return visit;
  }

  _event(tabId, kind, fromVisitId, toVisitId, occurredAt) {
    const event = {
      id: `event-${this.nextEventNumber++}`,
      tabId,
      kind,
      fromVisitId,
      toVisitId,
      occurredAt
    };
    this.events.push(event);
    return event;
  }

  _edge(fromVisitId, toVisitId, kind, createdAt) {
    const edge = {
      id: `edge-${this.nextEdgeNumber++}`,
      fromVisitId,
      toVisitId,
      kind,
      createdAt
    };
    this.edges.push(edge);
    return edge;
  }

  openTab({ tabId, openerTabId = null, restoredFromVisitId = null, timestamp } = {}) {
    const id = requiredId(tabId, "tabId");
    if (this.tabs.has(id)) throw new RangeError(`tab already exists: ${id}`);
    const openedAt = this._timestamp(timestamp);
    const openerId = optionalId(openerTabId);
    const opener = openerId === null ? null : this._tab(openerId);
    const restoredId = optionalId(restoredFromVisitId);
    if (restoredId !== null) this._visit(restoredId);
    const tab = {
      id,
      openerTabId: openerId,
      openedFromVisitId: opener ? opener.currentVisitId : null,
      restoredFromVisitId: restoredId,
      openedAt,
      closedAt: null,
      reopenedAt: null,
      currentVisitId: null,
      visitIds: []
    };
    this.tabs.set(id, tab);
    this._event(id, "open-tab", tab.openedFromVisitId || restoredId, null, openedAt);
    return { ...tab, visitIds: [] };
  }

  recordVisit({ tabId, url, title = "", timestamp, kind = "navigate", fromVisitId } = {}) {
    const tab = this._tab(tabId);
    if (tab.closedAt !== null) throw new RangeError(`tab is closed: ${tab.id}`);
    if (typeof url !== "string" || !url.trim()) throw new TypeError("url is required");
    if (typeof title !== "string") throw new TypeError("title must be a string");
    if (typeof kind !== "string" || !kind.trim()) throw new TypeError("kind is required");
    const visitedAt = this._timestamp(timestamp);
    const parentVisitId = fromVisitId === undefined ? tab.currentVisitId : optionalId(fromVisitId);
    if (parentVisitId !== null && this._visit(parentVisitId).tabId !== tab.id) {
      throw new RangeError("parent visit must belong to the tab");
    }
    const id = `visit-${this.nextVisitNumber++}`;
    const visit = {
      id,
      tabId: tab.id,
      url: url.trim(),
      title,
      visitedAt,
      parentVisitId,
      kind
    };
    this.visits.set(id, visit);
    tab.visitIds.push(id);
    tab.currentVisitId = id;
    if (parentVisitId !== null) this._edge(parentVisitId, id, "navigation", visitedAt);
    if (tab.visitIds.length === 1) {
      if (tab.openedFromVisitId !== null) this._edge(tab.openedFromVisitId, id, "opened-tab", visitedAt);
      if (tab.restoredFromVisitId !== null) this._edge(tab.restoredFromVisitId, id, "restored-tab", visitedAt);
    }
    this._event(tab.id, kind, parentVisitId, id, visitedAt);
    return copy(visit);
  }

  setCurrentVisit({ tabId, visitId, timestamp, kind = "history" } = {}) {
    const tab = this._tab(tabId);
    if (tab.closedAt !== null) throw new RangeError(`tab is closed: ${tab.id}`);
    const visit = this._visit(visitId);
    if (visit.tabId !== tab.id) throw new RangeError("visit must belong to the tab");
    if (typeof kind !== "string" || !kind.trim()) throw new TypeError("kind is required");
    const occurredAt = this._timestamp(timestamp);
    const fromVisitId = tab.currentVisitId;
    tab.currentVisitId = visit.id;
    this._event(tab.id, kind, fromVisitId, visit.id, occurredAt);
    return copy(visit);
  }

  updateVisit({ visitId, url, title } = {}) {
    const visit = this._visit(visitId);
    if (url !== undefined) {
      if (typeof url !== "string" || !url.trim()) throw new TypeError("url must be a non-empty string");
      visit.url = url.trim();
    }
    if (title !== undefined) {
      if (typeof title !== "string") throw new TypeError("title must be a string");
      visit.title = title;
    }
    return copy(visit);
  }

  closeTab({ tabId, timestamp } = {}) {
    const tab = this._tab(tabId);
    if (tab.closedAt !== null) return false;
    tab.closedAt = this._timestamp(timestamp);
    this._event(tab.id, "close-tab", tab.currentVisitId, null, tab.closedAt);
    return true;
  }

  reopenTab({ tabId, timestamp } = {}) {
    const tab = this._tab(tabId);
    if (tab.closedAt === null) return false;
    tab.reopenedAt = this._timestamp(timestamp);
    tab.closedAt = null;
    this._event(tab.id, "reopen-tab", null, tab.currentVisitId, tab.reopenedAt);
    return true;
  }

  getTab(tabId) {
    const tab = this._tab(tabId);
    return { ...tab, visitIds: tab.visitIds.slice() };
  }

  getVisit(visitId) {
    return copy(this._visit(visitId));
  }

  getSnapshot() {
    return {
      version: VERSION,
      tabs: Array.from(this.tabs.values(), tab => ({ ...tab, visitIds: tab.visitIds.slice() })),
      visits: Array.from(this.visits.values(), copy),
      edges: this.edges.map(copy),
      events: this.events.map(copy)
    };
  }

  static fromSnapshot(snapshot, options = {}) {
    if (!snapshot || snapshot.version !== VERSION || !Array.isArray(snapshot.tabs) ||
      !Array.isArray(snapshot.visits) || !Array.isArray(snapshot.edges) || !Array.isArray(snapshot.events)) {
      throw new TypeError("invalid navigation graph snapshot");
    }
    const graph = new NavigationGraph(options);
    for (const entry of snapshot.tabs) {
      const id = requiredId(entry && entry.id, "tab id");
      if (graph.tabs.has(id) || !Array.isArray(entry.visitIds)) throw new TypeError("invalid tab in snapshot");
      graph.tabs.set(id, { ...entry, id, visitIds: entry.visitIds.slice() });
    }
    for (const entry of snapshot.visits) {
      const id = requiredId(entry && entry.id, "visit id");
      if (graph.visits.has(id) || !graph.tabs.has(entry.tabId)) throw new TypeError("invalid visit in snapshot");
      graph.visits.set(id, copy(entry));
      graph.nextVisitNumber = Math.max(graph.nextVisitNumber, numberedId(id, "visit") + 1);
    }
    for (const tab of graph.tabs.values()) {
      if (tab.currentVisitId !== null && !graph.visits.has(tab.currentVisitId)) throw new TypeError("invalid current visit in snapshot");
      if (tab.visitIds.some(id => !graph.visits.has(id) || graph.visits.get(id).tabId !== tab.id)) {
        throw new TypeError("invalid tab visits in snapshot");
      }
    }
    for (const edge of snapshot.edges) {
      if (!edge || !graph.visits.has(edge.fromVisitId) || !graph.visits.has(edge.toVisitId)) {
        throw new TypeError("invalid edge in snapshot");
      }
      graph.edges.push(copy(edge));
      graph.nextEdgeNumber = Math.max(graph.nextEdgeNumber, numberedId(edge.id, "edge") + 1);
    }
    for (const event of snapshot.events) {
      if (!event || !graph.tabs.has(event.tabId)) throw new TypeError("invalid event in snapshot");
      graph.events.push(copy(event));
      graph.nextEventNumber = Math.max(graph.nextEventNumber, numberedId(event.id, "event") + 1);
    }
    return graph;
  }
}

function numberedId(value, prefix) {
  const match = new RegExp(`^${prefix}-(\\d+)$`).exec(value);
  if (!match) throw new TypeError(`invalid ${prefix} id in snapshot`);
  return Number(match[1]);
}

module.exports = { NavigationGraph };
