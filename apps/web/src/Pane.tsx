import { useState, useEffect, useRef } from "react";
import type {
  Tab,
  Observation,
  BrowserAction,
} from "../../../packages/protocol";
import { api } from "./api";
export function Pane({
  tab,
  frame,
  semantic,
  act,
  report,
  onClose,
}: {
  tab: Tab;
  frame?: string;
  semantic: boolean;
  act: (id: string, a: BrowserAction) => Promise<void>;
  report: (e: unknown) => void;
  onClose: () => void;
}) {
  const [address, setAddress] = useState(
      tab.url === "about:blank" ? "" : tab.url,
    ),
    [structure, setStructure] = useState<Observation>(),
    [text, setText] = useState("");
  const image = useRef<HTMLImageElement>(null);
  useEffect(
    () => setAddress(tab.url === "about:blank" ? "" : tab.url),
    [tab.url],
  );
  async function observe() {
    try {
      setStructure(await api<Observation>("/tabs/" + tab.id + "/structure"));
    } catch (e) {
      report(e);
    }
  }
  useEffect(() => {
    if (semantic) void observe();
  }, [semantic, tab.id, tab.url]);
  const action = (a: BrowserAction) =>
    void act(tab.id, a)
      .then(() => {
        if (semantic) void observe();
      })
      .catch(report);
  return (
    <section
      className="pane"
      aria-label={"Browser pane " + tab.id.slice(0, 6) + ": " + tab.title}
    >
      <div className="pane-heading">
        <span className="live-dot" />{" "}
        <span className="pane-title">{tab.title}</span>
        <span className="remote-label">REMOTE CHROMIUM</span>
        <button
          onClick={() =>
            action({
              type: "resize",
              width: Math.max(
                320,
                Math.min(
                  1920,
                  Math.round(
                    image.current?.clientWidth || window.innerWidth - 60,
                  ),
                ),
              ),
              height: 700,
            })
          }
          aria-label="Fit remote viewport to pane"
        >
          Fit
        </button>
        <button
          onClick={() =>
            void api("/tabs/" + tab.id + "/control", {}).catch(report)
          }
        >
          Take control
        </button>
        <button aria-label="Hide pane" onClick={onClose}>
          ×
        </button>
      </div>
      <form
        className="address"
        onSubmit={(e) => {
          e.preventDefault();
          action({ type: "navigate", url: address });
        }}
      >
        <button
          type="button"
          aria-label="Go back"
          onClick={() => action({ type: "back" })}
        >
          ←
        </button>
        <button
          type="button"
          aria-label="Go forward"
          onClick={() => action({ type: "forward" })}
        >
          →
        </button>
        <button
          type="button"
          aria-label="Reload page"
          onClick={() => action({ type: "reload" })}
        >
          ↻
        </button>
        <label className="sr-only" htmlFor={"address-" + tab.id}>
          Address or search
        </label>
        <input
          id={"address-" + tab.id}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Search or enter a website"
        />
        <button>Go</button>
      </form>
      {semantic ? (
        <div className="semantic">
          <div className="section-title">
            <h2>Page structure</h2>
            <button onClick={() => void observe()}>Refresh structure</button>
          </div>
          <p>{structure?.title}</p>
          <p className="page-text">{structure?.text}</p>
          <ol>
            {structure?.elements.map((el) => (
              <li key={el.id}>
                <span className="tag">{el.role}</span>{" "}
                {["input", "textarea", "select"].includes(el.tag) ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const data = new FormData(e.currentTarget);
                      action({
                        type: "fill",
                        element: el.id,
                        text: String(data.get("value")),
                      });
                    }}
                  >
                    <label>
                      {el.name || el.type || "Unnamed field"}
                      <input
                        name="value"
                        type={el.type === "password" ? "password" : "text"}
                        defaultValue={el.value}
                      />
                    </label>
                    <button disabled={el.disabled}>Fill remotely</button>
                  </form>
                ) : ["link", "button"].includes(el.role) ? (
                  <button
                    disabled={el.disabled}
                    onClick={() => action({ type: "click", element: el.id })}
                  >
                    {el.name || "Unnamed " + el.role}
                  </button>
                ) : (
                  <span>{el.name}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : tab.url === "about:blank" ? (
        <div className="blank">
          <div className="planet" />
          <span className="eyebrow">A LITTLE SPACE TO EXPLORE</span>
          <h2>Your next journey starts here.</h2>
          <p>Enter an address above. The website runs on your server.</p>
          <div className="quicklinks">
            {["Wikipedia", "YouTube", "Reddit"].map((site) => (
              <button
                key={site}
                onClick={() =>
                  action({
                    type: "navigate",
                    url:
                      "https://www." +
                      site.toLowerCase() +
                      "." +
                      (site === "Wikipedia" ? "org" : "com"),
                  })
                }
              >
                {site} ↗
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div
            className="viewport"
            role="application"
            tabIndex={0}
            aria-label="Remote webpage. Click to focus. Keyboard and scroll go to the server. Escape leaves remote input."
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.currentTarget.blur();
                return;
              }
              e.preventDefault();
              if (e.key.length === 1 && !e.ctrlKey && !e.metaKey)
                action({ type: "text", text: e.key });
              else
                action({
                  type: "key",
                  key: [
                    e.ctrlKey ? "Control" : null,
                    e.altKey ? "Alt" : null,
                    e.shiftKey ? "Shift" : null,
                    e.metaKey ? "Meta" : null,
                    e.key === " " ? "Space" : e.key,
                  ]
                    .filter(Boolean)
                    .join("+"),
                });
            }}
            onWheel={(e) =>
              action({
                type: "scroll",
                x: Math.max(-3000, Math.min(3000, e.deltaX)),
                y: Math.max(-3000, Math.min(3000, e.deltaY)),
              })
            }
            onClick={(e) => {
              e.currentTarget.focus();
              if (!image.current) return;
              const r = image.current.getBoundingClientRect();
              action({
                type: "pointer",
                x:
                  ((e.clientX - r.left) * image.current.naturalWidth) / r.width,
                y:
                  ((e.clientY - r.top) * image.current.naturalHeight) /
                  r.height,
              });
            }}
          >
            {frame ? (
              <img
                ref={image}
                draggable={false}
                alt={"Server-rendered webpage: " + tab.title}
                src={"data:image/jpeg;base64," + frame}
              />
            ) : (
              <p role="status">Waiting for the server-rendered frame…</p>
            )}
          </div>
          <form
            className="remote-text"
            onSubmit={(e) => {
              e.preventDefault();
              action({ type: "text", text });
              setText("");
            }}
          >
            <label className="sr-only" htmlFor={"text-" + tab.id}>
              Text for remote page
            </label>
            <input
              id={"text-" + tab.id}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type or paste text for the focused remote field"
            />
            <button>Send text</button>
            <button
              type="button"
              onClick={() => action({ type: "key", key: "Enter" })}
            >
              Send Enter
            </button>
          </form>
        </>
      )}
    </section>
  );
}
