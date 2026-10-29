import { loadAgentConfig } from "./agent-config.ts";
import { createAppServer } from "./app.ts";

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

const agent = await loadAgentConfig();
const app = await createAppServer({
  dev: process.env.NODE_ENV !== "production",
  dataDir: process.env.DATA_DIR,
  defaultDocx: process.env.DEFAULT_DOCX,
  agentModel: agent.model,
  agentModelId: agent.modelId,
  maxUploadBytes: envNumber("MAX_UPLOAD_BYTES", 10 * 1024 * 1024),
  maxRooms: envNumber("MAX_ROOMS", 100),
  maxOperations: envNumber("MAX_ROOM_OPERATIONS", 10_000),
});
const host = process.env.HOST ?? "127.0.0.1";
const port = envNumber("PORT", 3000);
app.server.listen(port, host, () => console.log(`WordPad Live is ready at http://${host}:${port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => void app.close().then(() => process.exit(0)));
