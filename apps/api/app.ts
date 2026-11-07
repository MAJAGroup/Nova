import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import files from "@fastify/static";
import websocket from "@fastify/websocket";
import rateLimit from "@fastify/rate-limit";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { WebSocket } from "ws";
import { Store } from "./db";
import { dataDir, encrypt, decrypt } from "./config";
import {
  id,
  hash,
  passwordHash,
  passwordMatches,
  destination,
  resolveAllowed,
} from "../../packages/security";
import { startProxy } from "../../packages/security/proxy";
import { ChromiumEngine } from "../../packages/browser-engine";
import {
  Action,
  type BrowserAction,
  type Tab,
  type Visit,
  type Task,
  type Approval,
  type Workspace,
  type Observation,
} from "../../packages/protocol";
import { AgentRunner } from "./agent";
interface Device {
  id: string;
  user_id: string;
  expires: number;
}
export async function createApp(
  options: { dir?: string; allowHosts?: string[]; logger?: boolean } = {},
) {
  const db = new Store(options.dir || dataDir),
    app = Fastify({ logger: options.logger ?? true, bodyLimit: 65536 });
  const proxy = await startProxy(
    options.allowHosts ||
      process.env.ALLOW_INTERNAL_HOSTS?.split(",").filter(Boolean) ||
      [],
  );
  const controls = new Map<string, { device: string; expires: number }>();
  const clients = new Map<string, Set<WebSocket>>();
  const engine = new ChromiumEngine(
    proxy.url,
    (tabId, url, title) => recordNavigation(tabId, url, title),
    async (opener, url, page) => {
      const t = makeTab(
        owner(opener.workspace_id),
        opener.workspace_id,
        "about:blank",
        opener.id,
      );
      engine.attach(t, page);
      if (url !== "about:blank") recordNavigation(t.id, url, "New page");
    },
    (workspace, state) =>
      db.run(
        "UPDATE workspaces SET storage=? WHERE id=?",
        encrypt(state),
        workspace,
      ),
  );
  function owner(workspace: string) {
    const w = db.get<{ user_id: string }>(
      "SELECT user_id FROM workspaces WHERE id=?",
      workspace,
    );
    if (!w) throw Error("Workspace unavailable");
    return w.user_id;
  }
  function recordNavigation(tabId: string, url: string, title: string) {
    const tab = db.get<Tab>("SELECT * FROM tabs WHERE id=?", tabId);
    if (!tab || tab.closed) return;
    if (tab.url === url && tab.current_visit) {
      db.run("UPDATE tabs SET title=? WHERE id=?", title || url, tabId);
      db.run(
        "UPDATE visits SET title=? WHERE id=?",
        title || url,
        tab.current_visit,
      );
      return;
    }
    const visit = id();
    db.db.transaction(() => {
      db.run(
        "INSERT INTO visits VALUES(?,?,?,?,?,?,?)",
        visit,
        tabId,
        url,
        title || "New tab",
        tab.current_visit,
        "navigation",
        Date.now(),
      );
      db.run(
        "UPDATE tabs SET url=?,title=?,current_visit=? WHERE id=?",
        url,
        title || "New tab",
        visit,
        tabId,
      );
    })();
  }
  function makeTab(
    user: string,
    workspace: string,
    url = "about:blank",
    opener: string | null = null,
  ) {
    ownedWorkspace(user, workspace);
    if (
      db.get<{ n: number }>(
        "SELECT count(*) n FROM tabs WHERE workspace_id IN (SELECT id FROM workspaces WHERE user_id=?) AND closed=0",
        user,
      )!.n >= Number(process.env.MAX_TABS || 12)
    )
      throw Error("Tab quota reached");
    const tab: Tab = {
      id: id(),
      workspace_id: workspace,
      url: "about:blank",
      title: "New tab",
      current_visit: null,
      closed: 0,
      opener,
    };
    db.run(
      "INSERT INTO tabs(id,workspace_id,opener) VALUES(?,?,?)",
      tab.id,
      workspace,
      opener,
    );
    const parent = opener
      ? db.get<Tab>("SELECT * FROM tabs WHERE id=?", opener)?.current_visit ||
        null
      : null;
    const visit = id();
    db.run(
      "INSERT INTO visits VALUES(?,?,?,?,?,?,?)",
      visit,
      tab.id,
      "about:blank",
      "New tab",
      parent,
      opener ? "opener" : "root",
      Date.now(),
    );
    db.run("UPDATE tabs SET current_visit=? WHERE id=?", visit, tab.id);
    tab.current_visit = visit;
    return tab;
  }
  function ownedWorkspace(user: string, w: string) {
    const row = db.get(
      "SELECT * FROM workspaces WHERE id=? AND user_id=?",
      w,
      user,
    );
    if (!row)
      throw Object.assign(Error("Workspace not found"), { statusCode: 404 });
    return row;
  }
  function ownedTab(user: string, t: string) {
    const tab = db.get<Tab>(
      "SELECT t.* FROM tabs t JOIN workspaces w ON w.id=t.workspace_id WHERE t.id=? AND w.user_id=?",
      t,
      user,
    );
    if (!tab) throw Object.assign(Error("Tab not found"), { statusCode: 404 });
    return tab;
  }
  async function open(tab: Tab) {
    const w = db.get<{ storage: string | null }>(
      "SELECT storage FROM workspaces WHERE id=?",
      tab.workspace_id,
    )!;
    return engine.open(tab, w.storage ? decrypt(w.storage) : undefined);
  }
  function state(user: string) {
    const u = db.get<{ id: string; email: string; preferences: string }>(
      "SELECT id,email,preferences FROM users WHERE id=?",
      user,
    )!;
    return {
      user: { ...u, preferences: JSON.parse(u.preferences) },
      brand: process.env.BRAND_NAME || "Cosmic",
      workspaces: db
        .all<Workspace & { panes: string }>(
          "SELECT id,name,panes,layout,ratio FROM workspaces WHERE user_id=?",
          user,
        )
        .map((w) => ({ ...w, panes: JSON.parse(w.panes) })),
      tabs: db.all<Tab>(
        "SELECT t.* FROM tabs t JOIN workspaces w ON w.id=t.workspace_id WHERE w.user_id=?",
        user,
      ),
      visits: db.all<Visit>(
        "SELECT v.* FROM visits v JOIN tabs t ON t.id=v.tab_id JOIN workspaces w ON w.id=t.workspace_id WHERE w.user_id=? ORDER BY v.created LIMIT 2000",
        user,
      ),
      tasks: db.all<Task>(
        "SELECT * FROM tasks WHERE user_id=? ORDER BY created DESC LIMIT 100",
        user,
      ),
      approvals: db.all<Approval>(
        "SELECT a.* FROM approvals a JOIN tasks t ON t.id=a.task_id WHERE t.user_id=?",
        user,
      ),
      steps: db.all(
        "SELECT s.* FROM steps s JOIN tasks t ON t.id=s.task_id WHERE t.user_id=? ORDER BY s.id DESC LIMIT 200",
        user,
      ),
      recovery:
        "Recovery restores URLs and saved cookies/local storage. In-memory page state and native back/forward stacks are lost after suspension or restart.",
      modelConfigured: !!process.env.AI_MODEL,
    };
  }
  async function perform(user: string, tabId: string, action: BrowserAction) {
    const tab = ownedTab(user, tabId);
    if (tab.closed) throw Error("Tab is closed");
    if (action.type === "navigate") {
      action = { ...action, url: destination(action.url) };
      if (action.url !== "about:blank") {
        const u = new URL(action.url);
        await resolveAllowed(
          u.hostname,
          Number(u.port || (u.protocol === "https:" ? 443 : 80)),
          options.allowHosts ||
            process.env.ALLOW_INTERNAL_HOSTS?.split(",").filter(Boolean) ||
            [],
        );
      }
    }
    await open(tab);
    await engine.act(tab, action);
    if (!["back", "forward"].includes(action.type)) {
      const page = await engine.open(tab);
      recordNavigation(tab.id, page.url(), await page.title());
    }
    if (["back", "forward"].includes(action.type)) {
      const p = await engine.open(tab),
        url = p.url();
      const previous =
        action.type === "back"
          ? db.get<Visit>(
              "SELECT * FROM visits WHERE id=(SELECT parent FROM visits WHERE id=?)",
              tab.current_visit,
            )
          : db.get<Visit>(
              "SELECT * FROM visits WHERE parent=? AND url=? ORDER BY created DESC LIMIT 1",
              tab.current_visit,
              url,
            );
      if (previous && previous.url === url)
        db.run(
          "UPDATE tabs SET current_visit=?,url=?,title=? WHERE id=?",
          previous.id,
          url,
          await p.title(),
          tab.id,
        );
      else if (url !== tab.url) recordNavigation(tab.id, url, await p.title());
    }
    await engine.checkpoint(tab.workspace_id);
  }
  const runner = new AgentRunner(db, engine, {
    ownedTab,
    open,
    perform,
    connected: (user) => (clients.get(user)?.size || 0) > 0,
  });
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 8192 } });
  await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
  function auth(req: FastifyRequest) {
    const token = req.cookies.cosmic;
    const device = token
      ? db.get<Device>(
          "SELECT * FROM devices WHERE token=? AND expires>?",
          hash(token),
          Date.now(),
        )
      : undefined;
    if (!device)
      throw Object.assign(Error("Sign in to continue"), { statusCode: 401 });
    return device;
  }
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
    if (req.method !== "GET" && req.method !== "HEAD") {
      const origin = req.headers.origin;
      const expected =
        process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.headers.host}`;
      if (origin && origin !== expected)
        throw Object.assign(Error("Cross-origin request rejected"), {
          statusCode: 403,
        });
      if (req.headers["x-cosmic-client"] !== "1")
        throw Object.assign(Error("Missing CSRF header"), { statusCode: 403 });
    }
  });
  app.setErrorHandler((error, req, reply) => {
    const e = error as Error & { statusCode?: number };
    const code = e instanceof z.ZodError ? 400 : e.statusCode || 400;
    reply.code(code).send({
      error: code >= 500 ? "Internal server error" : e.message.slice(0, 500),
    });
  });
  app.get("/api/health", async () => ({
    ok: true,
    browserConnected: engine.browser?.isConnected() || false,
    contexts: engine.contexts.size,
    memoryBytes: process.memoryUsage().rss,
  }));
  const credentials = z.object({
    email: z
      .string()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(12).max(200),
  });
  for (const mode of ["register", "login"])
    app.post(
      `/api/auth/${mode}`,
      { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
      async (req, reply) => {
        const body = credentials.parse(req.body);
        let user = db.get<{ id: string; password: string }>(
          "SELECT * FROM users WHERE email=?",
          body.email,
        );
        if (mode === "register") {
          if (process.env.REGISTRATION_DISABLED === "true")
            throw Error("Registration disabled");
          if (user) throw Error("Unable to register this address");
          const uid = id();
          db.db.transaction(() => {
            db.run(
              "INSERT INTO users(id,email,password,created) VALUES(?,?,?,?)",
              uid,
              body.email,
              passwordHash(body.password),
              Date.now(),
            );
            db.run(
              "INSERT INTO workspaces(id,user_id,name) VALUES(?,?,?)",
              id(),
              uid,
              "My universe",
            );
          })();
          user = { id: uid, password: "" };
        } else if (!user || !passwordMatches(body.password, user.password))
          throw Object.assign(Error("Invalid email or password"), {
            statusCode: 401,
          });
        const token = id() + id();
        db.run(
          "INSERT INTO devices VALUES(?,?,?,?,?,?)",
          id(),
          user!.id,
          hash(token),
          (req.headers["user-agent"] || "Client").slice(0, 100),
          Date.now() + 7 * 86400000,
          Date.now(),
        );
        reply.setCookie("cosmic", token, {
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.COOKIE_SECURE === "true",
          path: "/",
          maxAge: 7 * 86400,
        });
        return { ok: true };
      },
    );
  app.post("/api/auth/logout", async (req, reply) => {
    const d = auth(req);
    db.run("DELETE FROM devices WHERE id=?", d.id);
    reply.clearCookie("cosmic", { path: "/" });
    return { ok: true };
  });
  app.get("/api/state", async (req) => state(auth(req).user_id));
  app.get("/api/devices", async (req) =>
    db.all(
      "SELECT id,label,created,expires FROM devices WHERE user_id=?",
      auth(req).user_id,
    ),
  );
  app.delete<{ Params: { id: string } }>("/api/devices/:id", async (req) => {
    db.run(
      "DELETE FROM devices WHERE id=? AND user_id=?",
      req.params.id,
      auth(req).user_id,
    );
    return { ok: true };
  });
  app.post("/api/preferences", async (req) => {
    const user = auth(req).user_id,
      p = z
        .object({
          reducedMotion: z.boolean(),
          highContrast: z.boolean(),
          fontScale: z.number().min(1).max(1.6),
        })
        .parse(req.body);
    db.run(
      "UPDATE users SET preferences=? WHERE id=?",
      JSON.stringify(p),
      user,
    );
    return { ok: true };
  });
  app.post("/api/workspaces", async (req) => {
    const user = auth(req).user_id;
    const { name } = z
      .object({ name: z.string().min(1).max(100) })
      .parse(req.body);
    if (
      db.get<{ n: number }>(
        "SELECT count(*) n FROM workspaces WHERE user_id=?",
        user,
      )!.n >= 5
    )
      throw Error("Workspace quota reached");
    const w = id();
    db.run(
      "INSERT INTO workspaces(id,user_id,name) VALUES(?,?,?)",
      w,
      user,
      name,
    );
    return { id: w };
  });
  app.post("/api/tabs", async (req) => {
    const user = auth(req).user_id,
      b = z
        .object({
          workspace: z.string(),
          url: z.string().default("about:blank"),
          opener: z.string().optional(),
        })
        .parse(req.body);
    if (b.opener && ownedTab(user, b.opener).workspace_id !== b.workspace)
      throw Error("Opener must belong to workspace");
    const tab = makeTab(user, b.workspace, b.url, b.opener || null);
    await open(tab);
    if (b.url !== "about:blank")
      await perform(user, tab.id, { type: "navigate", url: b.url });
    return tab;
  });
  app.post<{ Params: { id: string } }>("/api/tabs/:id/close", async (req) => {
    const user = auth(req).user_id,
      t = ownedTab(user, req.params.id);
    runner.pauseTab(t.id);
    await engine.exclusive(t.id, async () => {
      await engine.closeTab(t.id);
      db.run("UPDATE tabs SET closed=1 WHERE id=?", t.id);
    });
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/api/tabs/:id/restore", async (req) => {
    const t = ownedTab(auth(req).user_id, req.params.id);
    db.run("UPDATE tabs SET closed=0 WHERE id=?", t.id);
    await open({ ...t, closed: 0 });
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/api/tabs/:id/control", async (req) => {
    const d = auth(req),
      t = ownedTab(d.user_id, req.params.id);
    runner.pauseTab(t.id);
    await engine.exclusive(t.id, async () =>
      controls.set(t.id, { device: d.id, expires: Date.now() + 30000 }),
    );
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/api/tabs/:id/action", async (req) => {
    const d = auth(req),
      t = ownedTab(d.user_id, req.params.id),
      action = Action.parse(req.body);
    const control = controls.get(t.id);
    if (control && control.expires > Date.now() && control.device !== d.id)
      throw Object.assign(
        Error("Another device controls this pane. Take control explicitly."),
        { statusCode: 409 },
      );
    if (runner.isActive(t.id))
      throw Object.assign(Error("Pause the agent or take control first"), {
        statusCode: 409,
      });
    controls.set(t.id, { device: d.id, expires: Date.now() + 30000 });
    await engine.exclusive(t.id, () => perform(d.user_id, t.id, action));
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>(
    "/api/tabs/:id/structure",
    async (req) => {
      const t = ownedTab(auth(req).user_id, req.params.id);
      await open(t);
      return engine.exclusive(t.id, () => engine.observe(t));
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/workspaces/:id/layout",
    async (req) => {
      const user = auth(req).user_id,
        w = req.params.id;
      ownedWorkspace(user, w);
      const b = z
        .object({
          panes: z.array(z.string()).max(4),
          layout: z.enum(["horizontal", "vertical"]),
          ratio: z.number().min(20).max(80),
        })
        .parse(req.body);
      for (const t of b.panes)
        if (ownedTab(user, t).workspace_id !== w)
          throw Error("Pane tab must belong to workspace");
      db.run(
        "UPDATE workspaces SET panes=?,layout=?,ratio=? WHERE id=?",
        JSON.stringify(b.panes),
        b.layout,
        b.ratio,
        w,
      );
      return { ok: true };
    },
  );
  app.post("/api/command", async (req) => {
    const user = auth(req).user_id,
      b = z
        .object({ workspace: z.string(), command: z.string().min(1).max(1000) })
        .parse(req.body);
    ownedWorkspace(user, b.workspace);
    const s = b.command.trim().replace(/\.$/, "");
    if (/show.*(universe|navigation|cosmic)/i.test(s))
      return { view: "universe" };
    if (/close the (right|left) pane/i.test(s)) {
      const w = state(user).workspaces.find((w) => w.id === b.workspace)!;
      w.panes.splice(/right/i.test(s) ? 1 : 0, 1);
      db.run(
        "UPDATE workspaces SET panes=? WHERE id=?",
        JSON.stringify(w.panes),
        w.id,
      );
      return { ok: true };
    }
    const w = state(user).workspaces.find((w) => w.id === b.workspace)!;
    if (/^switch to my /i.test(s)) {
      const name = s.replace(/^switch to my /i, "").replace(/ workspace$/i, "");
      const found = state(user).workspaces.find(
        (x) => x.name.toLowerCase() === name.toLowerCase(),
      );
      if (!found) throw Error("Workspace not found");
      return { workspace: found.id };
    }
    if (/^(move |make )/i.test(s)) {
      const term = s
        .replace(/^(move |make )/i, "")
        .replace(/ to the (left|right)$| full screen$/i, "")
        .toLowerCase();
      const tab = state(user).tabs.find(
        (t) =>
          t.workspace_id === w.id &&
          !t.closed &&
          (t.title + " " + t.url).toLowerCase().includes(term),
      );
      if (!tab) throw Error("Matching tab not found");
      const rest = w.panes.filter((x: string) => x !== tab.id);
      const panes = /full screen$/i.test(s)
        ? [tab.id]
        : /right$/i.test(s)
          ? [...rest.slice(0, 1), tab.id]
          : [tab.id, ...rest.slice(0, 1)];
      db.run(
        "UPDATE workspaces SET panes=? WHERE id=?",
        JSON.stringify(panes),
        w.id,
      );
      return { ok: true };
    }
    const names: Record<string, string> = {
      youtube: "https://www.youtube.com",
      reddit: "https://www.reddit.com",
      google: "https://www.google.com",
      wikipedia: "https://www.wikipedia.org",
    };
    let targets = s
      .replace(/^(open|split the screen between)\s+/i, "")
      .split(/\s+and\s+|,\s*/i)
      .map((x) => names[x.toLowerCase()] || x);
    if (
      !/^(open |split the screen between )/i.test(s) ||
      targets.length > 4 ||
      targets.some((x) => !/^https?:\/\/|^[\w.-]+\.[a-z]{2,}/i.test(x))
    )
      throw Error(
        "Try “Open YouTube and Reddit” or provide explicit website URLs. Use an AI task for other goals.",
      );
    const tabs = targets.map(() => makeTab(user, b.workspace));
    db.run(
      "UPDATE workspaces SET panes=? WHERE id=?",
      JSON.stringify(tabs.map((t) => t.id)),
      b.workspace,
    );
    const results = await Promise.allSettled(
      tabs.map((t, i) =>
        perform(user, t.id, { type: "navigate", url: targets[i] }),
      ),
    );
    return {
      tabs: tabs.map((t) => t.id),
      errors: results
        .filter((x) => x.status === "rejected")
        .map((x) => String((x as PromiseRejectedResult).reason)),
    };
  });
  app.post("/api/tasks", async (req) => {
    const user = auth(req).user_id,
      b = z
        .object({
          tab: z.string(),
          goal: z.string().min(1).max(4000),
          background: z.boolean(),
          externalPageConsent: z.literal(true),
          mode: z.enum(["assisted", "autonomous"]).default("assisted"),
        })
        .parse(req.body);
    ownedTab(user, b.tab);
    if (!process.env.AI_MODEL)
      throw Error(
        "No AI model configured. Basic browsing commands remain available.",
      );
    if (
      db.get<{ n: number }>(
        "SELECT count(*) n FROM tasks WHERE user_id=? AND status IN ('queued','running','waiting_approval')",
        user,
      )!.n >= 2
    )
      throw Error("Two active tasks allowed per user");
    if (runner.isActive(b.tab))
      throw Error("This tab already has an active task");
    if (b.mode === "autonomous") {
      if (state(user).workspaces.length >= 5)
        throw Error("Workspace quota reached");
      const source = ownedTab(user, b.tab),
        workspace = id();
      db.run(
        "INSERT INTO workspaces(id,user_id,name) VALUES(?,?,?)",
        workspace,
        user,
        "Agent: " + b.goal.slice(0, 50),
      );
      const isolated = makeTab(user, workspace);
      db.run(
        "UPDATE workspaces SET panes=? WHERE id=?",
        JSON.stringify([isolated.id]),
        workspace,
      );
      await perform(user, isolated.id, { type: "navigate", url: source.url });
      b.tab = isolated.id;
    }
    controls.delete(b.tab);
    const task = id();
    db.run(
      "INSERT INTO tasks(id,user_id,tab_id,goal,status,background,created) VALUES(?,?,?,?,?,?,?)",
      task,
      user,
      b.tab,
      b.goal,
      "queued",
      Number(b.background),
      Date.now(),
    );
    void runner.run(task);
    return { id: task };
  });
  app.post<{ Params: { id: string } }>(
    "/api/tasks/:id/:operation",
    async (req) => {
      const user = auth(req).user_id,
        p = req.params as { id: string; operation: string };
      const task = db.get<Task & { user_id: string }>(
        "SELECT * FROM tasks WHERE id=? AND user_id=?",
        p.id,
        user,
      );
      if (!task) throw Error("Task not found");
      if (p.operation === "resume") {
        if (!["paused", "failed"].includes(task.status))
          throw Error("Task cannot resume");
        db.run(
          "UPDATE tasks SET status='queued',error=NULL WHERE id=?",
          task.id,
        );
        void runner.run(task.id);
      } else if (["pause", "cancel"].includes(p.operation)) {
        runner.stop(task.id, p.operation === "cancel" ? "cancelled" : "paused");
      } else throw Error("Unknown task control");
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string } }>("/api/approvals/:id", async (req) => {
    const user = auth(req).user_id,
      { approve } = z.object({ approve: z.boolean() }).parse(req.body);
    await runner.decide(user, req.params.id, approve);
    return { ok: true };
  });
  app.delete("/api/history", async (req) => {
    const user = auth(req).user_id;
    if (
      db.get<{ n: number }>(
        "SELECT count(*) n FROM tasks WHERE user_id=? AND status IN ('running','queued','waiting_approval')",
        user,
      )!.n
    )
      throw Error("Pause or cancel tasks before clearing history");
    db.db.transaction(() => {
      db.run(
        "UPDATE tabs SET current_visit=NULL WHERE workspace_id IN (SELECT id FROM workspaces WHERE user_id=?)",
        user,
      );
      db.run(
        "DELETE FROM visits WHERE tab_id IN (SELECT t.id FROM tabs t JOIN workspaces w ON w.id=t.workspace_id WHERE w.user_id=?)",
        user,
      );
    })();
    return { ok: true };
  });
  app.delete("/api/account", async (req, reply) => {
    const user = auth(req).user_id;
    for (const w of state(user).workspaces) {
      for (const t of state(user).tabs.filter((t) => t.workspace_id === w.id))
        runner.pauseTab(t.id);
      await engine.suspend(w.id);
    }
    for (const socket of clients.get(user) || []) socket.close();
    db.run("DELETE FROM users WHERE id=?", user);
    reply.clearCookie("cosmic", { path: "/" });
    return { ok: true };
  });
  app.get(
    "/api/live",
    {
      websocket: true,
      preValidation: async (req) => {
        auth(req);
        const origin = req.headers.origin;
        if (
          origin &&
          origin !==
            (process.env.PUBLIC_ORIGIN ||
              `${req.protocol}://${req.headers.host}`)
        )
          throw Error("Origin rejected");
      },
    },
    (socket, req) => {
      const device = auth(req);
      const set = clients.get(device.user_id) || new Set<WebSocket>();
      set.add(socket);
      clients.set(device.user_id, set);
      let seq = 0,
        busy = false;
      socket.send(
        JSON.stringify({
          type: "state",
          seq: ++seq,
          state: state(device.user_id),
        }),
      );
      socket.on("message", (raw) => {
        void (async () => {
          if (busy) return;
          busy = true;
          try {
            auth(req);
            const b = z
              .object({
                type: z.literal("frame"),
                tab: z.string(),
                quality: z.number().int().min(25).max(85).default(65),
              })
              .parse(JSON.parse(raw.toString()));
            const t = ownedTab(device.user_id, b.tab);
            if (t.closed) throw Error("Tab closed");
            await open(t);
            const frame = await engine.frame(t, b.quality);
            if (socket.readyState === 1 && socket.bufferedAmount < 1000000)
              socket.send(
                JSON.stringify({
                  type: "frame",
                  tab: t.id,
                  seq: ++seq,
                  jpeg: frame.toString("base64"),
                }),
              );
          } catch (e) {
            if (socket.readyState === 1)
              socket.send(JSON.stringify({ type: "error", error: String(e) }));
          } finally {
            busy = false;
          }
        })();
      });
      const timer = setInterval(() => {
        try {
          auth(req);
          if (socket.bufferedAmount < 1000000 && socket.readyState === 1)
            socket.send(
              JSON.stringify({
                type: "state",
                seq: ++seq,
                state: state(device.user_id),
              }),
            );
          else if (socket.bufferedAmount > 2000000) socket.close();
        } catch {
          socket.close();
        }
      }, 1500);
      socket.on("close", () => {
        clearInterval(timer);
        set.delete(socket);
        if (!set.size) runner.disconnected(device.user_id);
      });
    },
  );
  const web = path.resolve("dist/web");
  if (existsSync(web)) {
    await app.register(files, { root: web });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.code(404).send({ error: "Not found" })
        : reply.sendFile("index.html"),
    );
  }
  const maintenance = setInterval(() => {
    db.run(
      "UPDATE tasks SET status='paused',error='Approval expired; resume to reobserve.' WHERE status='waiting_approval' AND id IN (SELECT task_id FROM approvals WHERE status='pending' AND expires<?)",
      Date.now(),
    );
    db.run(
      "UPDATE approvals SET status='expired' WHERE status='pending' AND expires<?",
      Date.now(),
    );
    for (const [w, time] of engine.lastUsed) {
      if (
        Date.now() - time > Number(process.env.IDLE_TIMEOUT_MS || 900000) &&
        !db.get(
          "SELECT id FROM tasks WHERE tab_id IN (SELECT id FROM tabs WHERE workspace_id=?) AND status IN ('queued','running')",
          w,
        )
      )
        void engine.suspend(w).catch(() => {});
      else void engine.checkpoint(w).catch(() => {});
    }
  }, 30000);
  app.addHook("onClose", async () => {
    clearInterval(maintenance);
    runner.shutdown();
    for (const sockets of clients.values())
      for (const socket of sockets) socket.close();
    await engine.close();
    await proxy.close();
    db.db.close();
  });
  return { app, db, engine, runner, state };
}
