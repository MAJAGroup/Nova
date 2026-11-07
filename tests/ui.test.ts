import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { createApp } from "../apps/api/app";
test(
  "web client: register, remote pane, keyboard navigation, universe, mobile and axe checks",
  { timeout: 90000 },
  async () => {
    const fixture = http.createServer((req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<title>Accessible planet</title><h1>Accessible planet</h1><a href="/next">Next discovery</a><label>Search<input></label>',
      );
    });
    await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
    const port = (fixture.address() as { port: number }).port;
    const dir = await mkdtemp(path.join(os.tmpdir(), "cosmic-ui-"));
    const { app } = await createApp({
      dir,
      allowHosts: [`127.0.0.1:${port}`],
      logger: false,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address() as { port: number };
    const browser = await chromium.launch({
      chromiumSandbox: process.env.CHROMIUM_SANDBOX !== "false",
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page
        .getByRole("button", { name: "New here? Create an account" })
        .click();
      await page.getByLabel("Email", { exact: true }).fill("ui@example.com");
      await page
        .getByLabel("Password (at least 12 characters)")
        .fill("testing long password");
      await page.getByRole("button", { name: "Create account" }).click();
      await page
        .getByRole("heading", { name: "A fresh corner of the universe." })
        .waitFor();
      const initialAxe = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(
        initialAxe.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        [],
      );
      await page
        .getByRole("textbox", { name: "Workspace command" })
        .fill(
          `Open http://127.0.0.1:${port}/ and http://127.0.0.1:${port}/next`,
        );
      await page.getByRole("button", { name: "Launch" }).click();
      await page
        .getByRole("img", { name: /Server-rendered webpage/ })
        .first()
        .waitFor();
      assert.equal(await page.locator(".pane").count(), 2);
      await page
        .getByRole("img", { name: /Server-rendered webpage/ })
        .nth(1)
        .waitFor();
      await page.screenshot({
        path: "artifacts/workspace.png",
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Accessible view", exact: false })
        .click();
      await page.getByText("Page structure", { exact: true }).first().waitFor();
      await page
        .getByRole("button", { name: "Refresh structure" })
        .first()
        .click();
      await page
        .getByRole("button", { name: "Next discovery", exact: true })
        .first()
        .waitFor();
      const semanticAxe = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(
        semanticAxe.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        [],
      );
      await page
        .getByRole("button", { name: "Universe", exact: false })
        .first()
        .click();
      await page
        .getByRole("heading", { name: "Your navigation universe" })
        .waitFor();
      await page.getByText(/Accessible navigation history/).waitFor();
      assert((await page.locator(".star-world").count()) >= 2);
      assert.equal(
        await page
          .locator(".star-world")
          .first()
          .evaluate((el) => getComputedStyle(el).animationName),
        "none",
      );
      await page.screenshot({ path: "artifacts/universe.png", fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole("button", { name: "Browser", exact: false })
        .first()
        .click();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({ path: "artifacts/mobile.png", fullPage: true });
      await page.keyboard.press("Control+j");
      assert.equal(
        await page
          .locator("#command")
          .evaluate((el) => el === document.activeElement),
        true,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await app.close();
      await new Promise<void>((r) => fixture.close(() => r()));
    }
  },
);
