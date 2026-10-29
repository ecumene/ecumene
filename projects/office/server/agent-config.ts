import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

import { createAnthropic } from "@ai-sdk/anthropic";

export const DEFAULT_AGENT_MODEL = "claude-sonnet-5-5";

/** Secrets stay in this Node process; neither room records nor browser messages receive them. */
export async function loadAgentConfig(
  environment: NodeJS.ProcessEnv = process.env,
  localEnvFile: URL = new URL("../.env", import.meta.url),
) {
  const local = await readFile(localEnvFile, "utf8")
    .then(parseEnv)
    .catch((error) => {
      if (error.code === "ENOENT") return {};
      throw error;
    });
  const settings = { ...local, ...environment };
  const apiKey = settings.ANTHROPIC_API_KEY?.trim();
  const modelId = settings.AGENT_MODEL || DEFAULT_AGENT_MODEL;
  return { modelId, model: apiKey ? createAnthropic({ apiKey })(modelId) : undefined };
}
