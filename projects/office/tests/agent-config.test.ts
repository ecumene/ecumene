import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { DEFAULT_AGENT_MODEL, loadAgentConfig } from "../server/agent-config.ts";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "office-config-"));
  const localEnvFile = pathToFileURL(path.join(directory, ".env"));
  return {
    directory,
    localEnvFile,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("missing explicit Anthropic key leaves Clippy unavailable", async () => {
  const f = await fixture();
  try {
    const config = await loadAgentConfig({}, f.localEnvFile);
    assert.equal(config.model, undefined);
    assert.equal(config.modelId, DEFAULT_AGENT_MODEL);
  } finally {
    await f.cleanup();
  }
});

test("borrowed key names and external environment files are ignored", async () => {
  const f = await fixture();
  try {
    const external = path.join(f.directory, "external.env");
    await writeFile(external, "ANTHROPIC_API_KEY=synthetic-external-key\n");
    await writeFile(
      f.localEnvFile,
      "RALLY_ANTHROPIC_API_KEY=synthetic-local-legacy-key\nBACKEND_ANTHROPIC_API_KEY=synthetic-local-backend-key\n",
    );
    const config = await loadAgentConfig(
      {
        RALLY_ANTHROPIC_API_KEY: "synthetic-legacy-key",
        BACKEND_ANTHROPIC_API_KEY: "synthetic-backend-key",
        ANTHROPIC_ENV_FILE: external,
      },
      f.localEnvFile,
    );
    assert.equal(config.model, undefined);
    const inaccessible = await loadAgentConfig(
      { ANTHROPIC_ENV_FILE: path.join(f.directory, "does-not-exist") },
      f.localEnvFile,
    );
    assert.equal(inaccessible.model, undefined, "the external path must not be opened");
  } finally {
    await f.cleanup();
  }
});

test("only the app-local explicit key enables Clippy and process settings override it", async () => {
  const f = await fixture();
  try {
    await writeFile(
      f.localEnvFile,
      "ANTHROPIC_API_KEY=synthetic-app-key\nAGENT_MODEL=synthetic-local-model\n",
    );
    const local = await loadAgentConfig({}, f.localEnvFile);
    assert.equal(local.model?.modelId, "synthetic-local-model");
    const explicit = await loadAgentConfig(
      { ANTHROPIC_API_KEY: "synthetic-dedicated-key", AGENT_MODEL: DEFAULT_AGENT_MODEL },
      f.localEnvFile,
    );
    assert.equal(explicit.model?.modelId, DEFAULT_AGENT_MODEL);
    const disabled = await loadAgentConfig({ ANTHROPIC_API_KEY: "   " }, f.localEnvFile);
    assert.equal(
      disabled.model,
      undefined,
      "an empty explicit environment key does not fall back to the local key",
    );
  } finally {
    await f.cleanup();
  }
});
