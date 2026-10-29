export const AGENT_CLIENT_ID = "clippy";
export const AGENT_NAME = "Clippy";

/** Public projection shared by every participant in a room. */
export type AgentState = {
  status: "idle" | "working" | "completed" | "cancelled" | "failed" | "interrupted" | "unavailable";
  runId: string | null;
  activity: string;
  requestedBy: string | null;
  model: string;
};
