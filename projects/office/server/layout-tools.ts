import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";

import { tool } from "ai";
import { z } from "zod";

export interface LayoutToolRuntime {
  snapshot(): Promise<{ bytes: Uint8Array; seq: number; block: number }>;
}

const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 200;
const pageInput = z
  .object({
    page: z.number().int().min(1).max(MAX_PAGES).describe("One-based physical page number."),
    expectedSeq: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Optional revision guard. Re-read after a collaborator changes the document."),
  })
  .strict();
const readPageInput = pageInput.extend({
  lineOffset: z.number().int().min(0).max(100_000).default(0),
  lineLimit: z.number().int().min(1).max(100).default(40),
});
const renderPageInput = pageInput.extend({
  scale: z
    .number()
    .min(0.5)
    .max(2)
    .default(1.5)
    .describe("Scale relative to 96 dpi. Large pages are reduced to the image pixel limit."),
});

interface PageMetadata {
  seq: number;
  block: number;
  page: number;
  pageCount: number;
  unit: "pt";
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  view: "final";
  notes: string[];
  fontFallbacks: { requested: string; served: string; reason: string }[];
}
interface PageLine {
  text: string;
  textTruncated: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  story: "body" | "header" | "footer";
  source?: { kind: string; bodyIndex: number; row?: number; col?: number };
}
interface ReadPageResult extends PageMetadata {
  totalLines: number;
  lineOffset: number;
  nextLineOffset: number | null;
  lines: PageLine[];
  tableCount: number;
  tables: {
    bodyIndex: number;
    rows: number;
    columns: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  tablesTruncated: boolean;
}
type RenderPageResult = PageMetadata &
  (
    | {
        status: "rendered";
        imageId: string;
        mediaType: "image/png";
        pixelWidth: number;
        pixelHeight: number;
        scale: number;
      }
    | { status: "unavailable"; reason: string }
  );
type WorkerResult =
  | ReadPageResult
  | (Omit<Extract<RenderPageResult, { status: "rendered" }>, "imageId"> & { png: Uint8Array })
  | Extract<RenderPageResult, { status: "unavailable" }>;

// This fixed worker has no model-supplied code, paths, or URLs. The SDK's synchronous
// layout cannot be interrupted by a timer on its own event loop. A separate worker
// lets the caller enforce a real deadline, including inside one enormous table.
// Each job gets one document-scoped registry, with portable fonts registered once.
const workerSource = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { parseDocx, layoutDocument, FontMeasurer, FontRegistry } = await import(workerData.browserModule);
  const { registerPortableFonts, renderPngPages } = await import(workerData.nodeModule);
  const registry = new FontRegistry();
  registerPortableFonts(undefined, registry);
  const checkDeadline = () => {
    if (Date.now() > workerData.deadline) throw new Error('LAYOUT_TIMEOUT: page inspection exceeded its time limit.');
  };
  const model = await parseDocx(workerData.bytes, {
    name: 'room.docx', registry, trackedChanges: 'final', comments: 'hidden', onProgress: checkDeadline,
  });
  const ir = layoutDocument(model, new FontMeasurer(registry), {
    sourcePath: 'room.docx', maxPages: workerData.maxPages + 1, pageColor: 'screen', onProgress: checkDeadline,
  });
  if (ir.pageCount > workerData.maxPages) {
    throw new Error('PAGE_LIMIT: document exceeds the 200-page inspection limit. Its complete pagination was not computed.');
  }
  const page = ir.pages.find(value => value.index === workerData.input.page);
  if (!page) throw new Error('PAGE_NOT_FOUND: requested page ' + workerData.input.page + '; document has ' + ir.pageCount + ' pages.');
  const pt = value => Math.round(value * 72 / 2540 * 100) / 100;
  const box = value => ({ x: pt(value.x), y: pt(value.y), width: pt(value.w), height: pt(value.h) });
  const metadata = {
    seq: workerData.seq, block: workerData.block, page: page.index, pageCount: ir.pageCount,
    unit: 'pt', width: pt(page.width), height: pt(page.height),
    margin: Object.fromEntries(Object.entries(page.margin).map(([key, value]) => [key, pt(value)])),
    view: 'final',
    notes: [
      'Final document view: insertions included, deletions and comment/revision balloons hidden.',
      'Portable font metrics; substitutions can differ from a machine with the original fonts. Unsupported metafiles may appear as placeholders.',
    ],
    fontFallbacks: (ir.fontFallbacks || []).slice(0, 20).map(value => ({
      requested: value.requested.slice(0, 100), served: value.served.slice(0, 100), reason: value.reason,
    })),
  };
  if (workerData.kind === 'read') {
    const allLines = page.lines.map(line => ({ line, story: line.story || 'body' }));
    for (const table of page.tables || []) {
      for (const cell of table.cells) {
        for (const line of cell.lines) allLines.push({ line, story: table.story || line.story || 'body' });
      }
    }
    // Physical top-to-bottom order, not inferred multi-column reading order.
    allLines.sort((a, b) => a.line.y - b.line.y || a.line.x - b.line.x);
    let remaining = 12000;
    const lines = [];
    for (const { line, story } of allLines.slice(workerData.input.lineOffset, workerData.input.lineOffset + workerData.input.lineLimit)) {
      if (remaining <= 0) break;
      const orderedRuns = [...line.runs].sort((a, b) => (a.logicalOrder ?? a.source?.textOffset ?? a.x) - (b.logicalOrder ?? b.source?.textOffset ?? b.x));
      const text = orderedRuns.map(run => run.logicalText ?? run.text).join('');
      const shown = text.slice(0, Math.min(2000, remaining));
      remaining -= shown.length;
      const source = line.source || line.runs.find(run => run.source)?.source;
      lines.push({
        ...box(line), text: shown, textTruncated: shown.length !== text.length, story,
        ...(source ? { source: { kind: source.kind, bodyIndex: source.bodyIndex,
          ...(source.kind === 'table-cell' ? { row: source.row, col: source.col } : {}) } } : {}),
      });
    }
    const end = workerData.input.lineOffset + lines.length;
    parentPort.postMessage({ ok: true, result: {
      ...metadata, totalLines: allLines.length, lineOffset: workerData.input.lineOffset,
      nextLineOffset: end < allLines.length ? end : null, lines,
      tableCount: page.tables.length,
      tables: page.tables.slice(0, 30).map(table => ({
        bodyIndex: table.bodyIndex, rows: table.rows, columns: table.cols, ...box(table.bbox),
      })),
      tablesTruncated: page.tables.length > 30,
    } });
    return;
  }
  const logicalWidth = page.width * 96 / 2540;
  const logicalHeight = page.height * 96 / 2540;
  const scale = Math.min(workerData.input.scale, Math.sqrt(4000000 / (logicalWidth * logicalHeight)), 4096 / Math.max(logicalWidth, logicalHeight));
  if (!Number.isFinite(scale) || scale < 0.1) throw new Error('IMAGE_SIZE_LIMIT: page dimensions exceed the bounded renderer.');
  let rendered;
  try {
    [rendered] = await renderPngPages(ir, { pages: [page.index], scale, registry });
  } catch (error) {
    if (String(error?.message).includes('optional "skia-canvas"')) {
      parentPort.postMessage({ ok: true, result: { ...metadata, status: 'unavailable',
        reason: 'PNG rendering is unavailable: the supported skia-canvas native renderer is not installed. read_page geometry is still available; no visual verification was performed.',
      } });
      return;
    }
    throw error;
  }
  if (!rendered || rendered.png.byteLength > workerData.maxImageBytes) throw new Error('IMAGE_SIZE_LIMIT: rendered image exceeded the 8 MiB limit.');
  checkDeadline();
  const png = Uint8Array.from(rendered.png);
  parentPort.postMessage({ ok: true, result: {
    ...metadata, status: 'rendered', mediaType: 'image/png', pixelWidth: rendered.width,
    pixelHeight: rendered.height, scale, png,
  } }, [png.buffer]);
})().catch(error => {
  // Do not surface SDK stack traces or host installation paths through tools.
  const message = String(error?.message || 'Unknown SDK layout error').replace(/(?:file:\/\/)?\/(?:Users|home|tmp|private|app)\/\S+/g, '[host path]').slice(0, 500);
  parentPort.postMessage({ ok: false, error: message });
});
`;

function runLayoutWorker(
  snapshot: Awaited<ReturnType<LayoutToolRuntime["snapshot"]>>,
  kind: "read" | "render",
  input: z.infer<typeof readPageInput> | z.infer<typeof renderPageInput>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: {
        ...snapshot,
        kind,
        input,
        deadline: Date.now() + timeoutMs,
        browserModule: import.meta.resolve("@reductoai/docx/browser"),
        nodeModule: import.meta.resolve("@reductoai/docx/node"),
        maxPages: MAX_PAGES,
        maxImageBytes: MAX_IMAGE_BYTES,
      },
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
    });
    let settled = false;
    const finish = (error?: Error, result?: WorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const onAbort = () => finish(new Error("LAYOUT_CANCELLED: page inspection was cancelled."));
    const timer = setTimeout(
      () => finish(new Error("LAYOUT_TIMEOUT: page inspection exceeded its time limit.")),
      timeoutMs,
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    worker.on("message", (message: { ok: boolean; error?: string; result?: WorkerResult }) => {
      finish(
        message.ok ? undefined : new Error(message.error || "SDK page inspection failed."),
        message.result,
      );
    });
    worker.on("error", () =>
      finish(
        new Error("LAYOUT_WORKER_FAILED: the SDK worker failed or exceeded its memory limit."),
      ),
    );
    worker.on("exit", (code) => {
      if (!settled)
        finish(
          new Error(
            `LAYOUT_WORKER_EXIT: page inspection stopped before completing (code ${code}).`,
          ),
        );
    });
  });
}

export function createLayoutTools(runtime: LayoutToolRuntime, limits: { timeoutMs?: number } = {}) {
  const timeoutMs = Math.max(1, Math.min(20_000, limits.timeoutMs ?? 20_000));
  const images = new Map<string, Uint8Array>();
  let active = 0;
  async function inspect(
    kind: "read" | "render",
    input: z.infer<typeof readPageInput> | z.infer<typeof renderPageInput>,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    if (active >= 2)
      throw new Error(
        "LAYOUT_BUSY: two page inspections are already running. Retry after they complete.",
      );
    active++;
    try {
      const snapshot = await runtime.snapshot();
      if (snapshot.bytes.byteLength > MAX_DOCUMENT_BYTES)
        throw new Error(
          "DOCUMENT_SIZE_LIMIT: page inspection accepts at most 32 MiB of DOCX bytes.",
        );
      if (input.expectedSeq !== undefined && snapshot.seq !== input.expectedSeq)
        throw new Error(
          "STALE_DOCUMENT: the room changed. Read the current document before inspecting its pages.",
        );
      return await runLayoutWorker(snapshot, kind, input, timeoutMs, signal);
    } finally {
      active--;
    }
  }
  return {
    read_page: tool({
      description:
        "Paginate the current room DOCX with the editor SDK and read one physical page. Geometry is in points, lines sorted top-to-bottom then left-to-right (not semantic column order). Includes table text and header/footer lines. Final view; at most 200 pages. Output is bounded and gives nextLineOffset when more lines remain. This does not prove visual correctness; use render_page.",
      inputSchema: readPageInput,
      execute: async (input, context): Promise<ReadPageResult> =>
        inspect("read", readPageInput.parse(input), context.abortSignal) as Promise<ReadPageResult>,
    }),
    render_page: tool({
      description:
        "Render one physical page from the current room DOCX with the SDK browser-equivalent painter. Returns an actual PNG to the model for visual verification and JSON metadata for the room log. Final view, portable fonts; at most 200 pages, 4 megapixels, and 8 MiB. Unavailability is explicit and must not be described as successful visual verification.",
      inputSchema: renderPageInput,
      execute: async (input, context): Promise<RenderPageResult> => {
        const result = await inspect("render", renderPageInput.parse(input), context.abortSignal);
        if (!("status" in result)) throw new Error("Unexpected page renderer result.");
        if (result.status === "unavailable") return result;
        const { png, ...metadata } = result;
        const imageId = randomUUID();
        images.set(imageId, png);
        while (images.size > 2) images.delete(images.keys().next().value!);
        return { ...metadata, imageId };
      },
      toModelOutput: ({ output }) => {
        const png = output.status === "rendered" ? images.get(output.imageId) : undefined;
        if (!png)
          return {
            type: "text",
            value: JSON.stringify(
              output.status === "rendered"
                ? {
                    ...output,
                    status: "unavailable",
                    reason:
                      "The transient page image expired. Call render_page again; metadata alone is not visual verification.",
                  }
                : output,
            ),
          };
        return {
          type: "content",
          value: [
            { type: "text", text: JSON.stringify(output) },
            {
              type: "file",
              mediaType: "image/png",
              filename: `page-${output.page}.png`,
              data: { type: "data", data: png },
            },
          ],
        };
      },
    }),
  };
}
