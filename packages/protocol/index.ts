import { z } from "zod";
export const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: z.string().max(4096) }),
  z.object({ type: z.enum(["back", "forward", "reload", "observe"]) }),
  z.object({ type: z.literal("click"), element: z.string().max(100) }),
  z.object({
    type: z.literal("fill"),
    element: z.string().max(100),
    text: z.string().max(10000),
  }),
  z.object({
    type: z.literal("pointer"),
    x: z.number().min(0).max(2560),
    y: z.number().min(0).max(1600),
  }),
  z.object({ type: z.literal("key"), key: z.string().max(50) }),
  z.object({ type: z.literal("text"), text: z.string().max(10000) }),
  z.object({
    type: z.literal("scroll"),
    x: z.number().min(-3000).max(3000),
    y: z.number().min(-3000).max(3000),
  }),
  z.object({
    type: z.literal("resize"),
    width: z.number().int().min(320).max(1920),
    height: z.number().int().min(240).max(1080),
  }),
  z.object({ type: z.literal("finish"), text: z.string().max(8000) }),
]);
export type BrowserAction = z.infer<typeof Action>;
export interface SemanticElement {
  id: string;
  role: string;
  name: string;
  tag: string;
  type: string;
  value?: string;
  href?: string;
  disabled: boolean;
}
export interface Observation {
  url: string;
  title: string;
  text: string;
  elements: SemanticElement[];
  snapshot: string;
}
export interface Tab {
  id: string;
  workspace_id: string;
  url: string;
  title: string;
  current_visit: string | null;
  closed: number;
  opener: string | null;
}
export interface Visit {
  id: string;
  tab_id: string;
  url: string;
  title: string;
  parent: string | null;
  kind: string;
  created: number;
}
export interface Workspace {
  id: string;
  name: string;
  panes: string[];
  layout: string;
  ratio: number;
}
export interface Task {
  id: string;
  tab_id: string;
  goal: string;
  status: string;
  background: number;
  steps: number;
  result: string;
  created: number;
  error: string | null;
}
export interface Approval {
  id: string;
  task_id: string;
  action: string;
  snapshot: string;
  status: string;
  expires: number;
}
export interface State {
  user: { id: string; email: string; preferences: Record<string, unknown> };
  workspaces: Workspace[];
  tabs: Tab[];
  visits: Visit[];
  tasks: Task[];
  approvals: Approval[];
  steps: { task_id: string; message: string; created: number }[];
  recovery: string;
  modelConfigured: boolean;
  brand: string;
}
