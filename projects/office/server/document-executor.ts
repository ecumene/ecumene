import { getQuickJS, type QuickJSHandle } from "quickjs-emscripten";

type DocumentOperations = {
  inspect(input: unknown): Promise<unknown>;
  search(input: unknown): Promise<unknown>;
  readTable(input: unknown): Promise<unknown>;
  review(input: unknown): Promise<unknown>;
  apply(input: unknown, toolCallId: string): Promise<unknown>;
};
type ExecutorOptions = {
  operations: DocumentOperations;
  searchApi(input: unknown): unknown;
  state: Record<string, unknown>;
  toolCallId: string;
  signal?: AbortSignal;
  /** Lower values are useful for deterministic resource-limit tests. */
  timeoutMs?: number;
  memoryBytes?: number;
};

/**
 * The guest receives JSON strings only. No SDK objects, Node functions or host
 * prototypes cross into QuickJS. This is deliberately the same bounded API as
 * the typed tools, not a reflection bridge to the vendor's live document.
 */
export async function executeDocumentCode(code: string, options: ExecutorOptions) {
  if (code.length > 20_000) throw new Error("Script exceeds 20,000 characters.");
  const wasm = await getQuickJS();
  const runtime = wasm.newRuntime();
  runtime.setMemoryLimit(Math.min(options.memoryBytes ?? 32 * 1024 * 1024, 32 * 1024 * 1024));
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + Math.min(options.timeoutMs ?? 15_000, 15_000);
  let stopped = false;
  runtime.setInterruptHandler(() => stopped || !!options.signal?.aborted || Date.now() > deadline);
  // No module loader is installed. Dynamic imports therefore cannot load host files.
  const vm = runtime.newContext();
  const pending = new Set<Promise<void>>();
  const output: unknown[] = [];
  let outputSize = 0;
  let calls = 0;
  let edits = 0;
  let committedEdits = 0;
  let executing = false;
  let resultHandle: QuickJSHandle | undefined;

  function guard() {
    if (stopped || options.signal?.aborted) throw new Error("Script was stopped.");
    if (Date.now() > deadline) throw new Error("Script exceeded its 15-second execution deadline.");
  }
  async function dispatch(method: string, json: string) {
    guard();
    if (json.length > 100_000) throw new Error("Tool input exceeds 100,000 characters.");
    if (++calls > 25) throw new Error("At most 25 document/API calls are allowed per script.");
    if (executing)
      throw new Error(
        "Await each document call before starting the next; concurrent calls are not supported.",
      );
    const input: unknown = JSON.parse(json);
    executing = true;
    try {
      if (method === "api.search") return options.searchApi(input);
      if (method === "doc.inspect") return await options.operations.inspect(input);
      if (method === "doc.search") return await options.operations.search(input);
      if (method === "doc.readTable") return await options.operations.readTable(input);
      if (method === "doc.review") return await options.operations.review(input);
      if (method === "doc.apply") {
        if (++edits > 5) throw new Error("At most 5 edit batches are allowed per script.");
        const result = await options.operations.apply(input, `${options.toolCallId}-${edits}`);
        if (result && typeof result === "object" && "changed" in result && result.changed)
          committedEdits++;
        return result;
      }
      throw new Error("Unknown document API method.");
    } finally {
      executing = false;
    }
  }

  const bridge = vm.newFunction("documentCall", (methodHandle, jsonHandle) => {
    if (vm.typeof(methodHandle) !== "string" || vm.typeof(jsonHandle) !== "string")
      throw new Error("Document calls require JSON strings.");
    const method = vm.getString(methodHandle);
    const json = vm.getString(jsonHandle);
    const deferred = vm.newPromise();
    const task = dispatch(method, json)
      .then((value) => {
        const encoded = JSON.stringify(value ?? null);
        if (encoded.length > 64_000) throw new Error("Tool output exceeds 64,000 characters.");
        const handle = vm.newString(encoded);
        try {
          deferred.resolve(handle);
        } finally {
          handle.dispose();
        }
      })
      .catch((error) => {
        const handle = vm.newError(
          error instanceof Error ? error.message : "Document call failed.",
        );
        try {
          deferred.reject(handle);
        } finally {
          handle.dispose();
        }
      })
      .finally(() => pending.delete(task));
    pending.add(task);
    return deferred.handle;
  });
  vm.setProp(vm.global, "__documentCall", bridge);
  bridge.dispose();
  const emit = vm.newFunction("text", (handle) => {
    guard();
    if (vm.typeof(handle) !== "string")
      throw new Error("Internal text encoder requires a JSON string.");
    const json = vm.getString(handle);
    outputSize += json.length;
    if (outputSize > 32_000 || output.length >= 100)
      throw new Error("Script output exceeds 32,000 characters or 100 entries.");
    output.push(JSON.parse(json));
    return vm.undefined;
  });
  vm.setProp(vm.global, "__text", emit);
  emit.dispose();

  const stateJson = JSON.stringify(options.state);
  if (stateJson.length > 20_000) {
    vm.dispose();
    runtime.dispose();
    throw new Error("Script state exceeds 20,000 characters.");
  }
  const setup = vm.evalCode(`
    (() => {
      const bridge = globalThis.__documentCall;
      const emit = globalThis.__text;
      delete globalThis.__documentCall;
      delete globalThis.__text;
      const call = async (method, input) => JSON.parse(await bridge(method, JSON.stringify(input ?? {})));
      globalThis.doc = Object.freeze({
        inspect: input => call('doc.inspect', input),
        search: input => call('doc.search', input),
        readTable: input => call('doc.readTable', input),
        review: input => call('doc.review', input),
        apply: input => call('doc.apply', input),
      });
      globalThis.api = Object.freeze({ search: query => call('api.search', typeof query === 'string' ? {query} : query) });
      globalThis.text = value => emit(JSON.stringify(value ?? null));
      globalThis.state = JSON.parse(${JSON.stringify(stateJson)});
    })();
  `);
  if (setup.error) {
    const error = vm.dump(setup.error);
    setup.error.dispose();
    vm.dispose();
    runtime.dispose();
    throw new Error(`Could not initialize document sandbox: ${String(error?.message ?? error)}`);
  }
  setup.value.dispose();

  try {
    guard();
    const result = vm.evalCode(`(async () => {\n${code}\n})()`, "document-script.js");
    if (result.error) {
      const error = vm.dump(result.error);
      result.error.dispose();
      throw new Error(String(error?.message ?? error));
    }
    resultHandle = result.value;
    while (true) {
      guard();
      const jobs = runtime.executePendingJobs(100);
      if (jobs.error) {
        const error = vm.dump(jobs.error);
        jobs.error.dispose();
        throw new Error(String(error?.message ?? error));
      }
      const state = vm.getPromiseState(resultHandle);
      if (state.type === "rejected") {
        const error = vm.dump(state.error);
        state.error.dispose();
        throw new Error(String(error?.message ?? error));
      }
      if (state.type === "fulfilled") {
        state.value.dispose();
        if (pending.size === 0 && !runtime.hasPendingJob()) break;
      }
      if (pending.size > 0) await Promise.race(pending);
      else if (!runtime.hasPendingJob()) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const saved = vm.evalCode("JSON.stringify(state)");
    if (saved.error) {
      const error = vm.dump(saved.error);
      saved.error.dispose();
      throw new Error(String(error?.message ?? error));
    }
    const nextState = vm.getString(saved.value);
    saved.value.dispose();
    if (nextState.length > 20_000) throw new Error("Script state exceeds 20,000 characters.");
    const parsed: unknown = JSON.parse(nextState);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("state must remain a JSON object.");
    for (const key of Object.keys(options.state)) delete options.state[key];
    for (const [key, value] of Object.entries(parsed)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) continue;
      Object.defineProperty(options.state, key, {
        value,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    return { ok: true, output, committedEdits };
  } catch (error) {
    stopped = true;
    await Promise.allSettled(pending);
    return {
      ok: false,
      output,
      committedEdits,
      error: error instanceof Error ? error.message : "Script failed.",
      note: committedEdits
        ? "Earlier successful doc.apply calls remain committed. A failed apply batch commits nothing."
        : "No successful edit batch was committed by this script.",
    };
  } finally {
    stopped = true;
    // Host callbacks must settle while their QuickJS promise handles still exist.
    await Promise.allSettled(pending);
    resultHandle?.dispose();
    vm.dispose();
    runtime.dispose();
  }
}
