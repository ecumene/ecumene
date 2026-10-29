import type { AgentState } from "../shared/agent";

export type { AgentState } from "../shared/agent";

export type ChatMessage = {
  id: string;
  clientId: string;
  name: string;
  text: string;
  sentAt: string;
  role?: "assistant";
};

export type ChatPeer = { id: string; name: string };
export type ChatState = {
  messages: ChatMessage[];
  pendingIds: string[];
  typing: ChatPeer[];
  error: string | null;
  agent?: AgentState | null;
};

export const emptyChat: ChatState = {
  messages: [],
  pendingIds: [],
  typing: [],
  error: null,
  agent: null,
};
