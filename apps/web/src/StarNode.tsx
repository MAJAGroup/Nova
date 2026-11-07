import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
export type StarData = {
  label: string;
  url: string;
  active: boolean;
  closed: boolean;
  order: number;
};
/** The visual star and the semantic node refer to the same persisted visit. */
export const StarNode = memo(function StarNode({
  data,
  selected,
}: NodeProps<Node<StarData>>) {
  let host = "New tab";
  try {
    host = new URL(data.url).hostname.replace(/^www\./, "") || "New tab";
  } catch {}
  return (
    <div
      className={`star-world ${data.active ? "star-live" : ""} ${data.closed ? "star-archived" : ""} ${selected ? "star-selected" : ""}`}
      style={{ animationDelay: `${Math.min(data.order, 12) * 45}ms` }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="star-aura" aria-hidden="true">
        <span className="star-orbit" />
        <span className="star-body" />
        <span className="star-core" />
        <span className="star-spark star-spark-one" />
        <span className="star-spark star-spark-two" />
      </div>
      <div className="star-caption">
        <strong>{data.label}</strong>
        <span>
          {host}
          {data.active ? " · live" : data.closed ? " · archived" : ""}
        </span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
