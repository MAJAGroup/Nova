import {
  StrictMode,
  Suspense,
  lazy,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { createRoot } from "react-dom/client";
import type { State, Tab, BrowserAction } from "../../../packages/protocol";
import { api } from "./api";
import { Pane } from "./Pane";
import { Tasks } from "./Tasks";
import "./styles.css";
const Universe = lazy(() => import("./Universe"));
function App() {
  const [state, setState] = useState<State>(),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [view, setView] = useState("browse"),
    [workspace, setWorkspace] = useState(""),
    [command, setCommand] = useState(""),
    [frames, setFrames] = useState<Record<string, string>>({}),
    [connected, setConnected] = useState(false),
    [quality, setQuality] = useState(60),
    [fps, setFps] = useState(2),
    [register, setRegister] = useState(false),
    [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const ws = useRef<WebSocket | null>(null),
    panesRef = useRef<string[]>([]),
    commandInput = useRef<HTMLInputElement>(null);
  const report = useCallback(
    (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    [],
  );
  const refresh = useCallback(async () => {
    try {
      setState(await api<State>("/state"));
    } catch (e) {
      if (String(e).includes("Sign in")) setState(undefined);
      else report(e);
    } finally {
      setReady(true);
    }
  }, [report]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const current =
    state?.workspaces.find((w) => w.id === workspace) || state?.workspaces[0];
  const tabs = state?.tabs.filter((t) => t.workspace_id === current?.id) || [];
  const panes =
    current?.panes.filter((id) => tabs.some((t) => t.id === id && !t.closed)) ||
    [];
  panesRef.current = view === "browse" || view === "focus" ? panes : [];
  useEffect(() => {
    if (!state?.user.id) return;
    let stopped = false,
      retry: ReturnType<typeof setTimeout>;
    function connect() {
      const socket = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/live`,
      );
      ws.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "state") setState(message.state);
        if (message.type === "frame")
          setFrames((f) => ({ ...f, [message.tab]: message.jpeg }));
        if (message.type === "error") report(message.error);
      };
      socket.onclose = () => {
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, 2000);
      };
    }
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      ws.current?.close();
    };
  }, [state?.user.id, report]);
  useEffect(() => {
    let i = 0;
    const timer = setInterval(() => {
      const ids = panesRef.current;
      if (
        ws.current?.readyState === 1 &&
        ids.length &&
        document.visibilityState === "visible"
      )
        ws.current.send(
          JSON.stringify({
            type: "frame",
            tab: ids[i++ % ids.length],
            quality,
          }),
        );
    }, 1000 / fps);
    return () => clearInterval(timer);
  }, [fps, quality]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "l") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".address input")?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "j") {
        e.preventDefault();
        commandInput.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const perform = async (id: string, action: BrowserAction) => {
    setError("");
    await api("/tabs/" + id + "/action", action);
    await refresh();
  };
  const layout = async (
    ids: string[],
    direction = current?.layout || "horizontal",
    ratio = current?.ratio || 50,
  ) => {
    if (!current) return;
    await api("/workspaces/" + current.id + "/layout", {
      panes: ids,
      layout: direction,
      ratio,
    });
    await refresh();
  };
  const select = async (tab: Tab, url?: string) => {
    try {
      if (tab.closed) await api("/tabs/" + tab.id + "/restore", {});
      await layout([tab.id, ...panes.filter((p) => p !== tab.id).slice(0, 1)]);
      if (url && url !== tab.url)
        await perform(tab.id, { type: "navigate", url });
      setView("browse");
    } catch (e) {
      report(e);
    }
  };
  const newTab = async () => {
    try {
      const t = await api<Tab>("/tabs", { workspace: current?.id });
      await layout([...panes.slice(0, 1), t.id]);
    } catch (e) {
      report(e);
    }
  };
  if (!ready)
    return (
      <main className="auth">
        <p role="status">Connecting to your universe…</p>
      </main>
    );
  if (!state)
    return (
      <main className="auth">
        <div className="auth-card">
          <div className="brand">
            <span className="logo">✧</span> COSMIC
          </div>
          <span className="eyebrow">YOUR BROWSER. A LITTLE MORE INFINITE.</span>
          <h1>
            A universe of possibility.
            <br />
            <em>One place to explore.</em>
          </h1>
          <p>
            A remote browser built around your curiosity, with accessible
            controls and a place for every journey.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              const data = new FormData(e.currentTarget);
              try {
                await api("/auth/" + (register ? "register" : "login"), {
                  email: data.get("email"),
                  password: data.get("password"),
                });
                await refresh();
              } catch (e) {
                report(e);
              }
            }}
          >
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
            <label htmlFor="password">Password (at least 12 characters)</label>
            <input
              id="password"
              name="password"
              type="password"
              minLength={12}
              autoComplete={register ? "new-password" : "current-password"}
              required
            />
            <button className="primary">
              {register ? "Create account" : "Sign in"} →
            </button>
            <button type="button" onClick={() => setRegister(!register)}>
              {register
                ? "Already have an account? Sign in"
                : "New here? Create an account"}
            </button>
          </form>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <p className="caption">
            Websites execute on your server. Your device receives images and
            structured content.
          </p>
        </div>
        <div className="auth-orbit" aria-hidden="true">
          <div className="planet" />
        </div>
      </main>
    );
  const prefs = state.user.preferences;
  return (
    <div
      className={`shell ${view === "focus" ? "focus-mode" : ""} ${prefs.highContrast ? "high-contrast" : ""} ${prefs.reducedMotion ? "reduce-motion" : ""}`}
      style={{ fontSize: `${Number(prefs.fontScale || 1)}em` }}
    >
      <a className="skip" href="#content">
        Skip to browsing content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">✧</span>
          {state.brand.toUpperCase()}
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <label className="sr-only" htmlFor="workspace">
          Workspace
        </label>
        <select
          id="workspace"
          value={current?.id || ""}
          onChange={(e) => setWorkspace(e.target.value)}
        >
          {state.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <button
          className="new-workspace"
          onClick={() => {
            const name = prompt("Workspace name");
            if (name)
              void api("/workspaces", { name }).then(refresh).catch(report);
          }}
        >
          + New workspace
        </button>
        <nav aria-label="Presentation modes">
          {[
            ["browse", "◫", "Browser"],
            ["universe", "✧", "Universe"],
            ["semantic", "≡", "Accessible view"],
            ["tasks", "◎", "Mission control"],
            ["focus", "◉", "Focus mode"],
            ["settings", "⚙", "Settings"],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              className={view === id ? "nav-active" : ""}
              aria-current={view === id ? "page" : undefined}
              onClick={() => setView(id)}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
              {id === "tasks" &&
              state.approvals.some((a) => a.status === "pending") ? (
                <span className="badge">!</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="section-title">
          <span className="workspace-label">YOUR TABS</span>
          <button aria-label="New tab" onClick={() => void newTab()}>
            +
          </button>
        </div>
        <div className="tab-list">
          {tabs
            .filter((t) => !t.closed)
            .map((t) => (
              <div
                className={panes.includes(t.id) ? "tab selected" : "tab"}
                key={t.id}
              >
                <button onClick={() => void select(t)}>
                  <span className="tab-star" aria-hidden="true">
                    ✦
                  </span>
                  {t.title}
                </button>
                <button
                  aria-label={"Close " + t.title}
                  onClick={() =>
                    void api("/tabs/" + t.id + "/close", {})
                      .then(refresh)
                      .catch(report)
                  }
                >
                  ×
                </button>
              </div>
            ))}
        </div>
        <details>
          <summary>Closed tabs</summary>
          {tabs
            .filter((t) => t.closed)
            .map((t) => (
              <button key={t.id} onClick={() => void select(t)}>
                Restore {t.title}
              </button>
            ))}
        </details>
        <div className="sidebar-footer">
          <span className="live-dot" />
          {connected ? "Connected to server" : "Reconnecting…"}
          <p>Server-rendered. Device-light.</p>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="eyebrow">{current?.name}</span>
            <strong>
              {view === "universe"
                ? "A map of your curiosity"
                : view === "tasks"
                  ? "Let curiosity lead the way"
                  : "Room for your next discovery"}
            </strong>
          </div>
          <div className="button-row">
            <button
              onClick={() => void layout(panes.slice().reverse()).catch(report)}
            >
              Swap panes
            </button>
            <button
              onClick={() =>
                void layout(
                  panes,
                  current?.layout === "vertical" ? "horizontal" : "vertical",
                ).catch(report)
              }
            >
              Rotate split
            </button>
            <button onClick={() => void newTab()}>+ New tab</button>
            <button
              onClick={() =>
                void api("/auth/logout", {})
                  .then(() => {
                    ws.current?.close();
                    setState(undefined);
                  })
                  .catch(report)
              }
            >
              Sign out
            </button>
          </div>
        </header>
        <form
          aria-label="Workspace commands"
          className="command"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              setError("");
              const result = await api<{
                view?: string;
                workspace?: string;
                errors?: string[];
              }>("/command", { workspace: current?.id, command });
              if (result.workspace) setWorkspace(result.workspace);
              if (result.view) setView(result.view);
              else setView("browse");
              if (result.errors?.length) report(result.errors.join("\n"));
              setCommand("");
              await refresh();
            } catch (e) {
              report(e);
            }
          }}
        >
          <span aria-hidden="true">✧</span>
          <label className="sr-only" htmlFor="command">
            Workspace command
          </label>
          <input
            id="command"
            ref={commandInput}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="Try “Open YouTube and Reddit” or “Show my navigation universe”"
          />
          <span className="key-hint">Ctrl J</span>
          <button>Launch →</button>
        </form>
        {error && (
          <div className="error" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        <main id="content" tabIndex={-1}>
          {["browse", "focus", "semantic"].includes(view) && (
            <>
              <div className="workspace-heading">
                <div>
                  <span className="eyebrow">YOUR LIVE WORKSPACE</span>
                  <h1>
                    {panes.length > 1
                      ? "Two worlds. One perspective."
                      : "Where to next?"}
                  </h1>
                </div>
                <span className="status">
                  {panes.length} active {panes.length === 1 ? "pane" : "panes"}
                </span>
              </div>
              {panes.length > 1 && (
                <label className="divider-control">
                  Pane balance
                  <input
                    aria-label="Pane balance"
                    type="range"
                    min="20"
                    max="80"
                    defaultValue={current?.ratio}
                    onPointerUp={(e) =>
                      void layout(
                        panes,
                        current?.layout,
                        Number(e.currentTarget.value),
                      ).catch(report)
                    }
                    onKeyUp={(e) =>
                      void layout(
                        panes,
                        current?.layout,
                        Number(e.currentTarget.value),
                      ).catch(report)
                    }
                  />
                </label>
              )}
              <div
                className={"panes " + current?.layout}
                style={{
                  gridTemplateColumns:
                    current?.layout === "horizontal" && panes.length === 2
                      ? `${current.ratio}fr ${100 - current.ratio}fr`
                      : undefined,
                }}
              >
                {panes.map((id) => (
                  <Pane
                    key={id}
                    tab={tabs.find((t) => t.id === id)!}
                    frame={frames[id]}
                    semantic={view === "semantic"}
                    act={perform}
                    report={report}
                    onClose={() =>
                      void layout(panes.filter((p) => p !== id)).catch(report)
                    }
                  />
                ))}
              </div>
              {!panes.length && (
                <div className="empty">
                  <div className="planet" />
                  <h2>A fresh corner of the universe.</h2>
                  <p>Open a tab or use a workspace command to begin.</p>
                  <button className="primary" onClick={() => void newTab()}>
                    Start exploring →
                  </button>
                </div>
              )}
            </>
          )}
          {view === "universe" && (
            <Suspense fallback={<p>Loading universe…</p>}>
              <Universe
                tabs={tabs}
                visits={state.visits}
                select={(t, url) => void select(t, url)}
              />
            </Suspense>
          )}
          {view === "tasks" && (
            <Tasks
              state={state}
              tab={panes[0]}
              refresh={refresh}
              report={report}
            />
          )}
          {view === "settings" && (
            <section className="settings">
              <h1>Make space your own</h1>
              <h2>Accessibility</h2>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  try {
                    await api("/preferences", {
                      reducedMotion: d.has("motion"),
                      highContrast: d.has("contrast"),
                      fontScale: Number(d.get("scale")),
                    });
                    await refresh();
                  } catch (e) {
                    report(e);
                  }
                }}
              >
                <label className="check">
                  <input
                    name="motion"
                    type="checkbox"
                    defaultChecked={!!prefs.reducedMotion}
                  />
                  Reduce motion
                </label>
                <label className="check">
                  <input
                    name="contrast"
                    type="checkbox"
                    defaultChecked={!!prefs.highContrast}
                  />
                  High contrast
                </label>
                <label>
                  Text scale
                  <select
                    name="scale"
                    defaultValue={Number(prefs.fontScale || 1)}
                  >
                    <option value="1">100%</option>
                    <option value="1.25">125%</option>
                    <option value="1.5">150%</option>
                  </select>
                </label>
                <button className="primary">Save preferences</button>
              </form>
              <h2>Streaming</h2>
              <label>
                JPEG quality: {quality}
                <input
                  type="range"
                  min="25"
                  max="85"
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                />
              </label>
              <label>
                Frames per second
                <select
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                >
                  <option value="1">1 · low bandwidth</option>
                  <option value="2">2 · balanced</option>
                  <option value="5">5 · smoother</option>
                </select>
              </label>
              <p>
                Frame transport has no browser audio. Use the accessible view
                for a lighter connection.
              </p>
              <h2>Session recovery</h2>
              <p>{state.recovery}</p>
              <h2>Devices and privacy</h2>
              <button
                onClick={() =>
                  void api<typeof devices>("/devices")
                    .then(setDevices)
                    .catch(report)
                }
              >
                Show signed-in devices
              </button>
              {devices.map((d) => (
                <p key={d.id}>
                  {d.label}
                  <button
                    onClick={() =>
                      void api("/devices/" + d.id, undefined, "DELETE")
                        .then(() =>
                          setDevices((a) => a.filter((x) => x.id !== d.id)),
                        )
                        .catch(report)
                    }
                  >
                    Revoke device
                  </button>
                </p>
              ))}
              <button
                onClick={() => {
                  if (confirm("Delete all navigation history?"))
                    void api("/history", undefined, "DELETE")
                      .then(refresh)
                      .catch(report);
                }}
              >
                Clear browsing history
              </button>
              <button
                className="danger"
                onClick={() => {
                  if (
                    confirm(
                      "Permanently delete your account, sessions, browser state, and tasks?",
                    )
                  )
                    void api("/account", undefined, "DELETE")
                      .then(() => {
                        setState(undefined);
                        ws.current?.close();
                      })
                      .catch(report);
                }}
              >
                Delete account and stored data
              </button>
            </section>
          )}
        </main>
        <footer className="bottom-bar">
          <span>✧ {state.brand} · Your curiosity, connected.</span>
          <span>Private workspace · Remote Chromium</span>
        </footer>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
