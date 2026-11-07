import { useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { StarNode } from "./StarNode";
const nodeTypes = { star: StarNode };
import type { Visit, Tab } from "../../../packages/protocol";
export default function Universe({
  visits,
  tabs,
  select,
}: {
  visits: Visit[];
  tabs: Tab[];
  select: (tab: Tab, url?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const relevant = useMemo(
    () =>
      visits.filter(
        (v) =>
          tabs.some((t) => t.id === v.tab_id) &&
          (!query ||
            (v.title + " " + v.url)
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [visits, tabs, query],
  );
  const { nodes, edges } = useMemo(() => {
    const idsPresent = new Set(relevant.map((v) => v.id));
    const children = new Map<string, Visit[]>();
    for (const visit of relevant)
      if (visit.parent && idsPresent.has(visit.parent)) {
        children.set(visit.parent, [
          ...(children.get(visit.parent) || []),
          visit,
        ]);
      }
    const positions = new Map<string, { x: number; y: number }>();
    let row = 0;
    function place(visit: Visit, depth: number): number {
      const descendants = children.get(visit.id) || [];
      const childRows = descendants.map((child) => place(child, depth + 1));
      const y = childRows.length
        ? (childRows[0] + childRows[childRows.length - 1]) / 2
        : row++ * 170;
      positions.set(visit.id, { x: depth * 285, y });
      return y;
    }
    for (const root of relevant.filter(
      (v) => !v.parent || !idsPresent.has(v.parent),
    ))
      place(root, 0);
    const nodes: Node[] = relevant.map((v, index) => {
      const active = tabs.some((t) => t.current_visit === v.id && !t.closed);
      return {
        id: v.id,
        type: "star",
        position: positions.get(v.id) || { x: 0, y: 0 },
        data: {
          label: v.title.slice(0, 55) || v.url,
          url: v.url,
          active,
          closed: !!tabs.find((t) => t.id === v.tab_id)?.closed,
          order: index,
        },
        className: "star-node",
        ariaLabel: v.title + " " + v.url,
      };
    });
    const ids = new Set(nodes.map((n) => n.id));
    const edges: Edge[] = relevant
      .filter((v) => v.parent && ids.has(v.parent))
      .map((v) => ({
        id: v.id + "-edge",
        source: v.parent!,
        target: v.id,
        label: v.kind === "opener" ? "new tab" : undefined,
        type: "default",
        className: "journey-trail",
        style: { stroke: "#8b7dc6", strokeWidth: 1.2, opacity: 0.55 },
      }));
    return { nodes, edges };
  }, [relevant, tabs]);
  return (
    <section className="universe">
      <div className="section-title">
        <div>
          <span className="eyebrow">EVERY VISIT IS A NEW WORLD</span>
          <h1>Your navigation universe</h1>
          <p className="universe-subtitle">
            Every page, a star. Every journey, a constellation.
          </p>
        </div>
        <label>
          Search history
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a page…"
          />
        </label>
      </div>
      <div className="graph">
        <ReactFlow
          nodeTypes={nodeTypes}
          nodes={nodes}
          edges={edges}
          fitView
          minZoom={0.15}
          maxZoom={2}
          nodesDraggable={false}
          onNodeClick={(_, node) => {
            const v = relevant.find((v) => v.id === node.id)!;
            select(
              tabs.find((t) => t.id === v.tab_id)!,
              v.url,
            );
          }}
        >
          <Background color="#30304d" gap={35} />
          <Controls />
        </ReactFlow>
      </div>
      <details open>
        <summary>
          Accessible navigation history · {relevant.length} visits
        </summary>
        <ol className="history-list">
          {relevant.map((v) => (
            <li key={v.id}>
              <button
                onClick={() =>
                  select(
                    tabs.find((t) => t.id === v.tab_id)!,
                    v.url,
                  )
                }
              >
                {v.title || v.url}
              </button>
              <span>
                {v.url} · {new Date(v.created).toLocaleString()}
                {v.parent
                  ? " · linked to " +
                    (visits.find((x) => x.id === v.parent)?.title ||
                      "earlier visit")
                  : ""}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
