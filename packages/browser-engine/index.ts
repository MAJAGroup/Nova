import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import type { BrowserAction, Observation, Tab } from "../protocol";
import { hash } from "../security";
export interface BrowserEngine {
  open(tab: Tab, storage?: string): Promise<Page>;
  act(tab: Tab, action: BrowserAction): Promise<void>;
  observe(tab: Tab): Promise<Observation>;
  frame(tab: Tab, quality: number): Promise<Buffer>;
  closeTab(id: string): Promise<void>;
  close(): Promise<void>;
}
export class ChromiumEngine implements BrowserEngine {
  browser?: Browser;
  launching?: Promise<void>;
  traversing = new Set<string>();
  contexts = new Map<string, BrowserContext>();
  pages = new Map<string, Page>();
  opening = new Map<string, Promise<Page>>();
  contextOpening = new Map<string, Promise<BrowserContext>>();
  busy = new Map<string, Promise<unknown>>();
  lastUsed = new Map<string, number>();
  constructor(
    private proxy: string,
    private changed: (tabId: string, url: string, title: string) => void,
    private popup: (opener: Tab, url: string, page: Page) => Promise<void>,
    private saveStorage: (workspace: string, state: string) => void,
  ) {}
  async start() {
    if (this.launching) return this.launching;
    this.launching = (async () => {
      this.browser = await chromium.launch({
        headless: true,
        chromiumSandbox: process.env.CHROMIUM_SANDBOX !== "false",
        proxy: { server: this.proxy, bypass: "<-loopback>" },
        args: [
          "--disable-quic",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
          "--proxy-bypass-list=<-loopback>",
        ],
      });
      this.browser.on("disconnected", () => {
        this.contexts.clear();
        this.pages.clear();
      });
    })();
    try {
      await this.launching;
    } finally {
      this.launching = undefined;
    }
  }
  async context(workspace: string, storage?: string) {
    let ctx = this.contexts.get(workspace);
    if (ctx) return ctx;
    let pending = this.contextOpening.get(workspace);
    if (!pending) {
      pending = (async () => {
        if (!this.browser?.isConnected()) await this.start();
        if (
          this.contexts.size + this.contextOpening.size >
          Number(process.env.MAX_CONTEXTS || 8)
        )
          throw Error("Server browser context quota reached");
        const context = await this.browser!.newContext({
          viewport: { width: 1100, height: 700 },
          serviceWorkers: "block",
          acceptDownloads: false,
          storageState: storage ? JSON.parse(storage) : undefined,
        });
        context.setDefaultTimeout(8000);
        await context.route("**/*", (route) => {
          const protocol = new URL(route.request().url()).protocol;
          return ["http:", "https:"].includes(protocol)
            ? route.continue()
            : route.abort();
        });
        context.on("page", (p) => p.on("download", (d) => void d.cancel()));
        this.contexts.set(workspace, context);
        return context;
      })();
      this.contextOpening.set(workspace, pending);
    }
    try {
      return await pending;
    } finally {
      this.contextOpening.delete(workspace);
    }
  }
  attach(tab: Tab, page: Page) {
    this.pages.set(tab.id, page);
    const notify = () => {
      if (this.traversing.has(tab.id)) return;
      const url = page.url();
      void page
        .title()
        .then((title) => {
          if (!this.traversing.has(tab.id) && page.url() === url)
            this.changed(tab.id, url, title);
        })
        .catch(() => {});
    };
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) notify();
    });
    page.on("domcontentloaded", notify);
    page.on("popup", (p) => {
      void this.popup(tab, p.url(), p).catch(() => p.close());
    });
    page.on("crash", () => this.pages.delete(tab.id));
    page.on("close", () => {
      if (this.pages.get(tab.id) === page) this.pages.delete(tab.id);
    });
  }
  async open(tab: Tab, storage?: string) {
    this.lastUsed.set(tab.workspace_id, Date.now());
    const page = this.pages.get(tab.id);
    if (page && !page.isClosed()) return page;
    let p = this.opening.get(tab.id);
    if (!p) {
      p = (async () => {
        const ctx = await this.context(tab.workspace_id, storage),
          page = await ctx.newPage();
        this.attach(tab, page);
        if (tab.url !== "about:blank")
          try {
            await page.goto(tab.url, {
              waitUntil: "domcontentloaded",
              timeout: 20000,
            });
          } catch {
            /* Page remains usable after failed navigation. */
          }
        return page;
      })();
      this.opening.set(tab.id, p);
    }
    try {
      return await p;
    } finally {
      this.opening.delete(tab.id);
    }
  }
  async exclusive<T>(id: string, fn: () => Promise<T>) {
    const previous = this.busy.get(id) || Promise.resolve();
    const current = previous.catch(() => {}).then(fn);
    this.busy.set(id, current);
    try {
      return await current;
    } finally {
      if (this.busy.get(id) === current) this.busy.delete(id);
    }
  }
  async act(tab: Tab, action: BrowserAction) {
    const p = await this.open(tab);
    switch (action.type) {
      case "navigate":
        await p.goto(action.url, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        break;
      case "back":
        this.traversing.add(tab.id);
        try {
          await p.goBack({ waitUntil: "domcontentloaded" });
        } finally {
          this.traversing.delete(tab.id);
        }
        break;
      case "forward":
        this.traversing.add(tab.id);
        try {
          await p.goForward({ waitUntil: "domcontentloaded" });
        } finally {
          this.traversing.delete(tab.id);
        }
        break;
      case "reload":
        await p.reload({ waitUntil: "domcontentloaded" });
        break;
      case "click":
        await p
          .locator(
            `[data-cosmic-id="${action.element.replace(/[^\w-]/g, "")}"]`,
          )
          .click();
        break;
      case "fill":
        await p
          .locator(
            `[data-cosmic-id="${action.element.replace(/[^\w-]/g, "")}"]`,
          )
          .fill(action.text);
        break;
      case "pointer":
        await p.mouse.click(action.x, action.y);
        break;
      case "key":
        await p.keyboard.press(action.key);
        break;
      case "text":
        await p.keyboard.insertText(action.text);
        break;
      case "scroll":
        await p.mouse.wheel(action.x, action.y);
        break;
      case "resize":
        await p.setViewportSize(action);
        break;
    }
  }
  async observe(tab: Tab): Promise<Observation> {
    const p = await this.open(tab);
    const data = await p.evaluate(() => {
      const elements = Array.from(
        document.querySelectorAll(
          "a,button,input,textarea,select,h1,h2,h3,[role],label,main,nav",
        ),
      )
        .filter((el) => el.getClientRects().length)
        .slice(0, 250)
        .map((el, index) => {
          if (!el.hasAttribute("data-cosmic-id"))
            el.setAttribute("data-cosmic-id", "c-" + crypto.randomUUID());
          const input = el as HTMLInputElement;
          const label =
            el.getAttribute("aria-label") ||
            document.getElementById(el.getAttribute("aria-labelledby") || "")
              ?.textContent ||
            input.labels?.[0]?.textContent ||
            el.textContent ||
            input.placeholder ||
            "";
          return {
            id: el.getAttribute("data-cosmic-id")!,
            role:
              el.getAttribute("role") ||
              {
                A: "link",
                BUTTON: "button",
                INPUT: "textbox",
                TEXTAREA: "textbox",
                SELECT: "combobox",
                H1: "heading",
                H2: "heading",
                H3: "heading",
                NAV: "navigation",
                MAIN: "main",
              }[el.tagName] ||
              el.tagName.toLowerCase(),
            name: label.trim().slice(0, 200),
            tag: el.tagName.toLowerCase(),
            type: input.type || "",
            value:
              input.type === "password"
                ? undefined
                : input.value?.slice(0, 300),
            href: el instanceof HTMLAnchorElement ? el.href : undefined,
            disabled: !!input.disabled,
          };
        });
      return {
        url: location.href,
        title: document.title,
        text: (document.body?.innerText || "").slice(0, 14000),
        elements,
      };
    });
    return { ...data, snapshot: hash(JSON.stringify(data)) };
  }
  async frame(tab: Tab, quality: number) {
    return (await this.open(tab)).screenshot({
      type: "jpeg",
      quality,
      timeout: 5000,
    });
  }
  async checkpoint(workspace: string) {
    const ctx = this.contexts.get(workspace);
    if (ctx)
      this.saveStorage(workspace, JSON.stringify(await ctx.storageState()));
  }
  async suspend(workspace: string) {
    await this.checkpoint(workspace);
    await this.contexts.get(workspace)?.close();
    this.contexts.delete(workspace);
    this.lastUsed.delete(workspace);
  }
  async closeTab(id: string) {
    await this.pages.get(id)?.close();
    this.pages.delete(id);
  }
  async close() {
    for (const id of this.contexts.keys())
      await this.checkpoint(id).catch(() => {});
    await this.browser?.close();
  }
}
