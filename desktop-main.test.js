"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

function harness(userData) {
  const handlers = new Map();
  const listeners = new Map();
  const windows = [];
  const views = [];
  const requests = [];
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    on(channel, handler) { listeners.set(channel, handler); },
    invoke(channel, ...args) {
      assert.ok(handlers.has(channel), `missing IPC handler: ${channel}`);
      return handlers.get(channel)(null, ...args);
    },
    send(channel, payload) {
      assert.ok(listeners.has(channel), `missing IPC listener: ${channel}`);
      return listeners.get(channel)(null, payload);
    }
  };

  class MockContents extends EventEmitter {
    constructor() {
      super();
      this.entries = [];
      this.index = -1;
      this.url = "";
      this.title = "";
      this.loading = false;
      this.destroyed = false;
      this.navigationHistory = {
        canGoBack: () => this.index > 0,
        canGoForward: () => this.index < this.entries.length - 1,
        getActiveIndex: () => this.index,
        getAllEntries: () => this.entries.map(url => ({ url, title: url })),
        length: () => this.entries.length,
        goToIndex: index => {
          this.index = index;
          this.url = this.entries[index];
          this.emit("did-navigate", {}, this.url, 200, "OK");
          this.emit("did-stop-loading");
        },
        clear: () => { this.entries = []; this.index = -1; }
      };
    }
    setWindowOpenHandler() {}
    getURL() { return this.url; }
    getTitle() { return this.title; }
    isLoading() { return this.loading; }
    isDestroyed() { return this.destroyed; }
    loadURL(url) {
      this.loading = true;
      this.emit("did-start-loading");
      this.entries = this.entries.slice(0, this.index + 1);
      this.entries.push(url);
      this.index += 1;
      this.url = url;
      this.title = url;
      this.emit("did-navigate", {}, url, 200, "OK");
      this.loading = false;
      this.emit("did-stop-loading");
      return Promise.resolve();
    }
    reload() { this.emit("did-navigate", {}, this.url, 200, "OK"); }
    stop() {}
    close() { this.destroyed = true; this.emit("destroyed"); }
    send() {}
  }

  class MockView {
    constructor() {
      this.webContents = new MockContents();
      this.visible = false;
      this.bounds = null;
      views.push(this);
    }
    setVisible(value) { this.visible = value; }
    setBounds(value) { this.bounds = value; }
  }

  class MockWindow extends EventEmitter {
    constructor() {
      super();
      this.webContents = new MockContents();
      this.contentView = { addChildView() {}, removeChildView() {} };
      windows.push(this);
    }
    isDestroyed() { return false; }
    loadFile() { setImmediate(() => this.webContents.emit("did-finish-load")); }
  }
  MockWindow.getAllWindows = () => windows;

  const permissionSession = { setPermissionCheckHandler() {}, setPermissionRequestHandler() {} };
  const electron = {
    app: { whenReady: () => Promise.resolve(), getPath: () => userData, on() {}, quit() {} },
    BrowserWindow: MockWindow,
    WebContentsView: MockView,
    ipcMain,
    Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({ popup() {} }) },
    dialog: { showMessageBox: async () => ({ response: 1 }) },
    safeStorage: { isAsyncEncryptionAvailable: async () => false },
    shell: { openExternal() {} },
    session: { defaultSession: permissionSession, fromPartition: () => permissionSession }
  };
  const source = fs.readFileSync(path.join(__dirname, "desktop-main.js"), "utf8");
  const mockRequire = id => id === "electron" ? electron : id === "./navigation-graph" ? require("./navigation-graph") : require(id);
  vm.runInNewContext(source, {
    require: mockRequire, __dirname, console, process, Buffer, URL,
    setTimeout, clearTimeout, setImmediate, AbortSignal,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Qwen ready" } }] }) };
    }
  }, { filename: "desktop-main.js" });
  return { ipcMain, windows, views, requests };
}

async function ready(h) {
  for (let i = 0; i < 100; i++) {
    if (h.windows.length && h.ipcMain.invoke("browser:get-tabs").tabs.length) break;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.equal(h.windows.length, 1);
  assert.ok(h.ipcMain.invoke("browser:get-tabs").tabs.length > 0);
}

test("split panes keep independent tabs, navigation, and visible bounds", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-main-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const h = harness(dir);
  await ready(h);
  const first = h.ipcMain.invoke("browser:get-tabs").activeId;
  h.ipcMain.invoke("browser:set-layout", "vertical");
  const second = h.ipcMain.invoke("browser:new-tab", "https://two.example", "secondary");
  h.ipcMain.send("browser:set-bounds", {
    primary: { x: 0, y: 100, width: 400, height: 400 },
    secondary: { x: 408, y: 100, width: 400, height: 400 }
  });
  assert.equal(h.views[0].visible, true);
  assert.equal(h.views[1].visible, true);
  assert.equal(h.views[1].bounds.x, 408);
  h.ipcMain.invoke("browser:navigate", "https://three.example");
  const tabs = h.ipcMain.invoke("browser:get-tabs");
  assert.equal(tabs.layout.primaryTabId, first);
  assert.equal(tabs.layout.secondaryTabId, second);
  assert.equal(tabs.tabs.find(tab => tab.id === first).url, "https://www.google.com/");
  assert.equal(tabs.tabs.find(tab => tab.id === second).url, "https://three.example/");
  h.windows[0].emit("close");
  const savedSession = JSON.parse(fs.readFileSync(path.join(dir, "orbit-session.json"), "utf8"));
  assert.equal(savedSession.layout.mode, "vertical");
  assert.equal(savedSession.layout.secondaryTabId, second);
  const restarted = harness(dir);
  await ready(restarted);
  assert.equal(restarted.ipcMain.invoke("browser:get-tabs").layout.mode, "vertical");
  assert.equal(restarted.ipcMain.invoke("browser:get-tabs").tabs.length, 2);
  restarted.ipcMain.send("browser:set-bounds", {
    primary: { x: 0, y: 100, width: 400, height: 400 },
    secondary: { x: 408, y: 100, width: 400, height: 400 }
  });
  assert.equal(restarted.views[1].visible, true);
  restarted.ipcMain.invoke("browser:close-second-pane");
  assert.equal(restarted.ipcMain.invoke("browser:get-tabs").layout.primaryTabId, first);
  assert.equal(restarted.ipcMain.invoke("browser:get-tabs").tabs.length, 2);
  assert.equal(restarted.views[1].visible, false);
});

test("history after Back branches and old visits can be restored", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-main-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const h = harness(dir);
  await ready(h);
  h.ipcMain.invoke("browser:navigate", "https://one.example");
  h.ipcMain.invoke("browser:navigate", "https://two.example");
  h.ipcMain.invoke("browser:back");
  h.ipcMain.invoke("browser:navigate", "https://three.example");
  const graph = h.ipcMain.invoke("browser:get-navigation");
  const one = graph.visits.find(visit => visit.url === "https://one.example/");
  const two = graph.visits.find(visit => visit.url === "https://two.example/");
  const three = graph.visits.find(visit => visit.url === "https://three.example/");
  assert.equal(two.parentVisitId, one.id);
  assert.equal(three.parentVisitId, one.id);
  assert.ok(graph.events.some(event => event.kind === "back"));
  assert.equal(h.ipcMain.invoke("browser:go-to-visit", two.id), true);
  assert.equal(h.ipcMain.invoke("browser:get-tabs").activeId !== null, true);
});

test("Empire AI tunnel endpoint works without an API key and session is saved", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-main-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const h = harness(dir);
  await ready(h);
  const saved = await h.ipcMain.invoke("ai:save-config", {
    url: "http://localhost:11435/v1/chat/completions", model: "qwen3.8:27b", apiKey: ""
  });
  assert.equal(saved.connected, true);
  const answer = await h.ipcMain.invoke("ai:ask", { prompt: "ping", context: [] });
  assert.equal(answer.text, "Qwen ready");
  assert.equal(h.requests[0].url, "http://localhost:11435/v1/chat/completions");
  assert.equal(h.requests[0].options.headers.Authorization, undefined);
  h.windows[0].emit("close");
  const session = JSON.parse(fs.readFileSync(path.join(dir, "orbit-session.json"), "utf8"));
  assert.equal(session.tabs.length, 1);
  assert.equal(session.navigation.visits.length, 1);
  const restarted = harness(dir);
  await ready(restarted);
  assert.equal(restarted.ipcMain.invoke("browser:get-tabs").tabs.length, 1);
  assert.equal(restarted.ipcMain.invoke("browser:get-navigation").visits.length, 1);
});
