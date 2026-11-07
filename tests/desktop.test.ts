import { test } from "node:test";
import assert from "node:assert/strict";
import { _electron as electron } from "playwright";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test(
  "native desktop browser: Chromium tabs, living stars, inspector actions, split and recovery",
  { timeout: 90000 },
  async () => {
    const server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(
        "<title>" +
          (req.url === "/two" ? "Second world" : "First world") +
          '</title><h1>Native browser fixture</h1><a href="/two">Next world</a><input aria-label="Name">',
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port,
      url = `http://127.0.0.1:${port}`,
      dir = await mkdtemp(path.join(os.tmpdir(), "orbit-desktop-"));
    const launch = () =>
      electron.launch({
        args: process.env.ORBIT_TEST_EXECUTABLE
          ? ["--disable-gpu"]
          : [path.resolve("."), "--disable-gpu"],
        env: { ...process.env, ORBIT_USER_DATA: dir, ORBIT_START_URL: url },
        executablePath:
          process.env.ORBIT_TEST_EXECUTABLE || require("electron"),
      });
    let desktop: Awaited<ReturnType<typeof launch>> | undefined;
    try {
      desktop = await launch();
      const window = await desktop.firstWindow();
      await window.waitForSelector(".cosmic-star");
      await window.locator(".cosmic-star").first().click();
      await window
        .getByRole("heading", { name: "First world", exact: true })
        .waitFor();
      await window
        .getByRole("button", { name: "Pin star", exact: true })
        .click();
      await window
        .getByRole("button", { name: "Unpin star", exact: true })
        .waitFor();
      await window
        .getByRole("button", { name: "Duplicate", exact: true })
        .click();
      await window.waitForFunction(
        () => document.querySelectorAll(".cosmic-star").length === 2,
      );
      await window.getByLabel("Search universe tabs").fill("First world");
      assert.equal(await window.locator(".cosmic-star").count(), 2);
      await window.locator(".cosmic-star").first().click();
      await window
        .getByRole("button", { name: "Mute tab", exact: true })
        .click();
      await window
        .getByRole("button", { name: "Unmute tab", exact: true })
        .waitFor();
      await window
        .getByRole("button", { name: "Split with active", exact: true })
        .click();
      await window.waitForSelector("#browser-content:not([hidden])");
      const native = await desktop.evaluate(
        ({ webContents }) =>
          webContents
            .getAllWebContents()
            .filter((c) => c.getURL().startsWith("http://127.0.0.1:")).length,
      );
      assert.equal(native, 2);
      const pages = await desktop.context().pages();
      const website = pages.find((p) => p.url().startsWith(url));
      assert(website);
      await website.getByLabel("Name").fill("Real Chromium input");
      assert.equal(
        await website.getByLabel("Name").inputValue(),
        "Real Chromium input",
      );
      await website.getByRole("link", { name: "Next world" }).click();
      await website.waitForURL(url + "/two");
      await window
        .getByRole("button", { name: "Universe", exact: true })
        .click();
      await window
        .getByRole("button", { name: "Reduce motion", exact: true })
        .click();
      assert.equal(
        await window
          .locator(".native-star-visual")
          .first()
          .evaluate((el) => getComputedStyle(el).animationName),
        "none",
      );
      await window.getByLabel("Search universe tabs").fill("");
      const closeInspector = window.getByRole("button", {
        name: "Close star details",
      });
      if (await closeInspector.isVisible()) await closeInspector.click();
      await window.screenshot({ path: "artifacts/desktop-universe.png" });
      await window.getByLabel("Search universe tabs").fill("Second world");
      await window.waitForFunction(
        () => document.querySelectorAll(".cosmic-star").length === 1,
      );
      await window.locator(".cosmic-star").first().click();
      await window.getByText("2 pages visited", { exact: true }).waitFor();
      await window.screenshot({ path: "artifacts/desktop-inspector.png" });
      await window
        .getByRole("button", { name: "Close tab", exact: true })
        .click();
      await window.waitForFunction(
        () => document.querySelectorAll(".cosmic-star").length === 0,
      );
      await window
        .getByRole("button", { name: "Reopen closed", exact: false })
        .click();
      await window.waitForFunction(
        () => document.querySelectorAll(".cosmic-star").length === 1,
      );
      await window.getByLabel("Search universe tabs").fill("");
      await desktop.close();
      desktop = await launch();
      const recovered = await desktop.firstWindow();
      await recovered.waitForFunction(
        () => document.querySelectorAll(".cosmic-star").length === 2,
      );
      assert.equal(await recovered.locator(".pinned-star").count(), 1);
    } finally {
      await desktop?.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
);
