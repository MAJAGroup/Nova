import { useState } from "react";
import type { State } from "../../../packages/protocol";
import { api } from "./api";
export function Tasks({
  state,
  tab,
  refresh,
  report,
}: {
  state: State;
  tab?: string;
  refresh: () => Promise<void>;
  report: (e: unknown) => void;
}) {
  const [goal, setGoal] = useState(""),
    [background, setBackground] = useState(false),
    [consent, setConsent] = useState(false),
    [mode, setMode] = useState("assisted");
  const run = async (url: string, body: unknown) => {
    try {
      await api(url, body);
      await refresh();
    } catch (e) {
      report(e);
    }
  };
  return (
    <section className="task-view">
      <span className="eyebrow">A CO-PILOT FOR YOUR CURIOSITY</span>
      <h1>Mission control</h1>
      <p>
        Tasks operate on the selected remote tab. You can pause, inspect, and
        take control at any time.
      </p>
      {!state.modelConfigured && (
        <p className="notice">
          No AI model is configured. Use the command bar to open websites and
          split panes.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run("/tasks", {
            tab,
            goal,
            background,
            externalPageConsent: consent,
            mode,
          });
        }}
      >
        <label htmlFor="goal">What would you like to do?</label>
        <textarea
          id="goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Research a topic on the current page…"
          required
        />
        <label>
          Execution mode
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="assisted">Assist on selected tab</option>
            <option value="autonomous">Separate autonomous workspace</option>
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={background}
            onChange={(e) => setBackground(e.target.checked)}
          />
          Continue after I disconnect
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          I allow this page’s text and controls to be sent to the configured AI
          provider.
        </label>
        <button
          className="primary"
          disabled={!state.modelConfigured || !tab || !consent}
        >
          Start task
        </button>
      </form>
      <div className="task-list">
        {state.tasks.map((task) => (
          <article key={task.id}>
            <div className="section-title">
              <h2>{task.goal}</h2>
              <span className="status">{task.status.replace("_", " ")}</span>
            </div>
            <p>
              {task.steps}/20 actions ·{" "}
              {task.background ? "Background enabled" : "Pauses on disconnect"}
            </p>
            {task.error && <p role="status">{task.error}</p>}
            {task.result && <p className="result">{task.result}</p>}
            <div className="button-row">
              <button
                onClick={() => void run("/tasks/" + task.id + "/pause", {})}
              >
                Pause / take over
              </button>
              <button
                disabled={!["paused", "failed"].includes(task.status)}
                onClick={() => void run("/tasks/" + task.id + "/resume", {})}
              >
                Resume
              </button>
              <button
                disabled={["completed", "cancelled"].includes(task.status)}
                onClick={() => void run("/tasks/" + task.id + "/cancel", {})}
              >
                Cancel
              </button>
            </div>
            {state.approvals
              .filter((a) => a.task_id === task.id && a.status === "pending")
              .map((a) => (
                <div className="approval" key={a.id}>
                  <h3>Approval required</h3>
                  <p>
                    The agent proposes this exact action. Review the remote page
                    before approving.
                  </p>
                  <pre>{JSON.stringify(JSON.parse(a.action), null, 2)}</pre>
                  <p>Expires {new Date(a.expires).toLocaleTimeString()}</p>
                  <button
                    className="primary"
                    onClick={() =>
                      void run("/approvals/" + a.id, { approve: true })
                    }
                  >
                    Approve once
                  </button>
                  <button
                    onClick={() =>
                      void run("/approvals/" + a.id, { approve: false })
                    }
                  >
                    Reject
                  </button>
                </div>
              ))}
            <details>
              <summary>Action log</summary>
              <ol>
                {state.steps
                  .filter((s) => s.task_id === task.id)
                  .slice()
                  .reverse()
                  .map((s, i) => (
                    <li key={i}>{s.message}</li>
                  ))}
              </ol>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
