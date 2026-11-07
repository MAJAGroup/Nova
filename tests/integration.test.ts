import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../apps/api/app";
import { id } from "../packages/security";
import type { State, Tab, Observation } from "../packages/protocol";
import { WebSocket } from "ws";
async function waitFor(fn: () => boolean | Promise<boolean>, timeout = 10000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw Error("Condition timed out");
    await new Promise((r) => setTimeout(r, 40));
  }
}
test(
  "real Chromium browsing, branching graph, split panes, isolation, approvals, streaming and recovery",
  { timeout: 120000 },
  async (t) => {
    const fixture = http.createServer((req, res) => {
      res.setHeader("Content-Type", "text/html");
      if (req.url === "/two") {
        res.end(
          '<title>Second planet</title><h1>Second planet</h1><a href="/three">Third</a>',
        );
        return;
      }
      if (req.url === "/three") {
        res.end("<title>Third planet</title><h1>Third planet</h1>");
        return;
      }
      res.end(
        '<title>First planet</title><h1>First planet</h1><a href="/two">Visit second</a><a href="/three">Visit third</a><label>Your name<input id="name"></label><button onclick="document.querySelector(\'output\').textContent=document.querySelector(\'input\').value">Greet</button><output></output><button onclick="window.open(\'/two\')">Popup</button><script>document.body.dataset.executed="on-server"</script>',
      );
    });
    await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
    const port = (fixture.address() as { port: number }).port,
      origin = `http://127.0.0.1:${port}`,
      dir = await mkdtemp(path.join(os.tmpdir(), "cosmic-test-"));
    let service = await createApp({
      dir,
      allowHosts: [`127.0.0.1:${port}`],
      logger: false,
    });
    await service.app.listen({ port: 0, host: "127.0.0.1" });
    let address = service.app.server.address() as { port: number };
    let cookieA = "",
      cookieB = "";
    async function call(
      url: string,
      body?: unknown,
      cookie = cookieA,
      method = body === undefined ? "GET" : "POST",
    ) {
      return service.app.inject({
        method: method as "GET" | "POST",
        url: "/api" + url,
        headers: {
          cookie,
          "x-cosmic-client": "1",
          "content-type": "application/json",
        },
        payload: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    try {
      await t.test(
        "authentication, CSRF and cross-user isolation",
        async () => {
          const a = await call("/auth/register", {
            email: "a@example.com",
            password: "correct horse battery",
          });
          assert.equal(a.statusCode, 200, a.body);
          cookieA = a.headers["set-cookie"]!.toString().split(";")[0];
          const b = await call("/auth/register", {
            email: "b@example.com",
            password: "correct horse battery",
          });
          assert.equal(b.statusCode, 200);
          cookieB = b.headers["set-cookie"]!.toString().split(";")[0];
          assert.equal((await call("/state", undefined, "")).statusCode, 401);
          assert.equal(
            (
              await service.app.inject({
                method: "POST",
                url: "/api/preferences",
                headers: { cookie: cookieA, origin: "https://evil.example" },
                payload: {},
              })
            ).statusCode,
            403,
          );
        },
      );
      let state = (await call("/state")).json<State>();
      const workspace = state.workspaces[0].id;
      const created = await call("/tabs", { workspace, url: origin });
      assert.equal(created.statusCode, 200, created.body);
      const tab = created.json<Tab>();
      const action = async (a: unknown) => {
        const r = await call("/tabs/" + tab.id + "/action", a);
        assert.equal(r.statusCode, 200, r.body);
      };
      const observe = async () => {
        const r = await call("/tabs/" + tab.id + "/structure");
        assert.equal(r.statusCode, 200, r.body);
        return r.json<Observation>();
      };
      await t.test(
        "page JavaScript, semantic typing, click, back, forward, reload, failure recovery",
        async () => {
          assert.equal(
            await service.engine.pages
              .get(tab.id)!
              .evaluate(() => document.body.dataset.executed),
            "on-server",
          );
          let o = await observe();
          assert.equal(o.title, "First planet");
          const input = o.elements.find((e) => e.tag === "input")!;
          await action({
            type: "fill",
            element: input.id,
            text: "Cosmic explorer",
          });
          await action({
            type: "click",
            element: o.elements.find((e) => e.name === "Greet")!.id,
          });
          assert.match((await observe()).text, /Cosmic explorer/);
          await action({
            type: "click",
            element: o.elements.find((e) => e.name === "Visit second")!.id,
          });
          await waitFor(async () => (await observe()).url.endsWith("/two"));
          await action({ type: "back" });
          assert.equal((await observe()).title, "First planet");
          await action({ type: "forward" });
          assert.equal((await observe()).title, "Second planet");
          await action({ type: "reload" });
          await action({ type: "back" });
          o = await observe();
          await action({
            type: "click",
            element: o.elements.find((e) => e.name === "Visit third")!.id,
          });
          await waitFor(async () => (await observe()).title === "Third planet");
          const failed = await call("/tabs/" + tab.id + "/action", {
            type: "navigate",
            url: "http://127.0.0.1:1",
          });
          assert(failed.statusCode >= 400);
          await action({ type: "navigate", url: origin });
          assert.equal((await observe()).title, "First planet");
        },
      );
      await t.test(
        "branching history and independent split panes",
        async () => {
          state = (await call("/state")).json<State>();
          const root = state.visits.find(
            (v) => v.tab_id === tab.id && v.url === origin + "/",
          )!;
          assert(root);
          assert(
            state.visits.some(
              (v) => v.parent === root.id && v.url.endsWith("/two"),
            ),
          );
          assert(
            state.visits.some(
              (v) => v.parent === root.id && v.url.endsWith("/three"),
            ),
          );
          const command = await call("/command", {
            workspace,
            command: `Open ${origin}/two and ${origin}/three`,
          });
          assert.equal(command.statusCode, 200, command.body);
          state = (await call("/state")).json<State>();
          const panes = state.workspaces[0].panes;
          assert.equal(panes.length, 2);
          assert(
            state.tabs.find((t) => t.id === panes[0])!.url.endsWith("/two"),
          );
          assert(
            state.tabs.find((t) => t.id === panes[1])!.url.endsWith("/three"),
          );
          const r = await call("/tabs/" + panes[0] + "/action", {
            type: "navigate",
            url: origin,
          });
          assert.equal(r.statusCode, 200);
          assert(
            (await call("/tabs/" + panes[1] + "/structure"))
              .json<Observation>()
              .url.endsWith("/three"),
          );
        },
      );
      await t.test(
        "ownership checks cover tab, stream, history, task and approval boundaries",
        async () => {
          for (const url of [
            "/tabs/" + tab.id + "/structure",
            "/tabs/" + tab.id + "/control",
            "/tabs/" + tab.id + "/action",
          ]) {
            const r = await call(
              url,
              url.endsWith("structure") ? undefined : { type: "reload" },
              cookieB,
            );
            assert.equal(r.statusCode, 404, r.body);
          }
          assert.equal(
            (await call("/state", undefined, cookieB)).json<State>().visits
              .length,
            0,
          );
          const socket = new WebSocket(
            `ws://127.0.0.1:${address.port}/api/live`,
            { headers: { Cookie: cookieB } },
          );
          await new Promise<void>((r) => socket.once("open", r));
          const message = new Promise<any>((r) =>
            socket.on("message", (raw) => {
              const m = JSON.parse(raw.toString());
              if (m.type === "error") r(m);
            }),
          );
          socket.send(
            JSON.stringify({ type: "frame", tab: tab.id, quality: 40 }),
          );
          assert.match((await message).error, /Tab not found/);
          socket.close();
        },
      );
      await t.test(
        "visual frame is produced by real Chromium and authenticated WebSocket",
        async () => {
          const socket = new WebSocket(
            `ws://127.0.0.1:${address.port}/api/live`,
            { headers: { Cookie: cookieA } },
          );
          const frame = new Promise<any>((r) =>
            socket.on("message", (raw) => {
              const m = JSON.parse(raw.toString());
              if (m.type === "frame") r(m);
            }),
          );
          await new Promise<void>((r) => socket.once("open", r));
          socket.send(
            JSON.stringify({ type: "frame", tab: tab.id, quality: 40 }),
          );
          const m = await frame;
          assert(Buffer.from(m.jpeg, "base64").length > 1000);
          assert.equal(
            Buffer.from(m.jpeg, "base64").subarray(0, 2).toString("hex"),
            "ffd8",
          );
          socket.close();
        },
      );
      await t.test(
        "sensitive action blocks until approval; tokens single-use, reject, expire and state-bound",
        async () => {
          const user = state.user.id,
            task = id();
          service.db.run(
            "INSERT INTO tasks(id,user_id,tab_id,goal,status,background,created) VALUES(?,?,?,?,?,?,?)",
            task,
            user,
            tab.id,
            "Greet user",
            "waiting_approval",
            1,
            Date.now(),
          );
          let o = await observe();
          const a = id();
          service.db.run(
            "INSERT INTO approvals VALUES(?,?,?,?,?,?)",
            a,
            task,
            JSON.stringify({
              type: "fill",
              element: o.elements.find((e) => e.tag === "input")!.id,
              text: "Approved value",
            }),
            o.snapshot,
            "pending",
            Date.now() + 60000,
          );
          assert.equal(
            await service.engine.pages
              .get(tab.id)!
              .locator("input")
              .inputValue(),
            "",
          );
          assert(
            (await call("/approvals/" + a, { approve: true }, cookieB))
              .statusCode >= 400,
          );
          const r = await call("/approvals/" + a, { approve: true });
          assert.equal(r.statusCode, 200, r.body);
          assert.equal(
            await service.engine.pages
              .get(tab.id)!
              .locator("input")
              .inputValue(),
            "Approved value",
          );
          assert(
            (await call("/approvals/" + a, { approve: true })).statusCode >=
              400,
          );
          await waitFor(() => !service.runner.running.has(task));
          service.runner.stop(task, "paused");
          for (const [status, expires] of [
            ["pending", Date.now() - 1],
            ["rejected", Date.now() + 60000],
          ] as const) {
            service.db.run(
              "UPDATE tasks SET status='waiting_approval' WHERE id=?",
              task,
            );
            const aid = id();
            service.db.run(
              "INSERT INTO approvals VALUES(?,?,?,?,?,?)",
              aid,
              task,
              JSON.stringify({ type: "key", key: "Enter" }),
              o.snapshot,
              status,
              expires,
            );
            assert(
              (await call("/approvals/" + aid, { approve: true })).statusCode >=
                400,
            );
          }
          service.runner.stop(task, "paused");
        },
      );
      await t.test("popup relationship, close and restore", async () => {
        const o = await observe();
        await action({
          type: "click",
          element: o.elements.find((e) => e.name === "Popup")!.id,
        });
        await waitFor(
          () =>
            service.db.all<Tab>("SELECT * FROM tabs WHERE opener=?", tab.id)
              .length === 1,
        );
        const child = service.db.get<Tab>(
          "SELECT * FROM tabs WHERE opener=?",
          tab.id,
        )!;
        const visit = service.db.get<{ kind: string }>(
          "SELECT kind FROM visits WHERE tab_id=? ORDER BY created LIMIT 1",
          child.id,
        )!;
        assert.equal(visit.kind, "opener");
        assert.equal(
          (await call("/tabs/" + child.id + "/close", {})).statusCode,
          200,
        );
        assert.equal(
          (await call("/tabs/" + child.id + "/restore", {})).statusCode,
          200,
        );
      });
      await t.test(
        "workspace, layout, history, device sessions, approvals and storage persist across restart",
        async () => {
          await service.engine.pages
            .get(tab.id)!
            .evaluate(() => localStorage.setItem("continuity", "saved"));
          await service.engine.checkpoint(workspace);
          const visits = service.state(state.user.id).visits.length;
          await service.app.close();
          service = await createApp({
            dir,
            allowHosts: [`127.0.0.1:${port}`],
            logger: false,
          });
          await service.app.listen({ port: 0, host: "127.0.0.1" });
          const recovered = (await call("/state")).json<State>();
          assert.equal(recovered.visits.length, visits);
          assert.equal(recovered.workspaces[0].panes.length, 2);
          assert(recovered.tasks.length > 0);
          assert(recovered.approvals.length > 0);
          await observe();
          assert.equal(
            await service.engine.pages
              .get(tab.id)!
              .evaluate(() => localStorage.getItem("continuity")),
            "saved",
          );
        },
      );
    } finally {
      await service.app.close();
      await new Promise<void>((r) => fixture.close(() => r()));
    }
  },
);
