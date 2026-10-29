import assert from "node:assert/strict";
import test from "node:test";

import { CollabServer } from "@reductoai/docx/collab";
import { DocxSession, SessionReplica } from "@reductoai/docx/editor";
import { WordDocument } from "@reductoai/docx/officejs";

import { executeDocumentCode } from "../server/document-executor.ts";
import {
  createDocumentOperations,
  searchDocumentApi,
  type DocumentToolRuntime,
} from "../server/document-tools.ts";

async function fixture(initialText = "The buyer pays within thirty days.") {
  const original = await WordDocument.create();
  original.body.paragraphs.items[0].insertText(initialText, "Replace");
  let bytes = await original.toBytes();
  let seq = 0;
  let rejectCommit = false;
  const server = new CollabServer();
  const receipts = new Map<string, number>();
  const runtime: DocumentToolRuntime = {
    async snapshot() {
      return { bytes, seq, block: 2 };
    },
    async commit(input) {
      if (rejectCommit || input.base !== seq)
        throw new Error("STALE_DOCUMENT: a collaborator changed the document.");
      const key = `${input.runId}:${input.toolCallId}`;
      if (receipts.has(key)) return { seq: receipts.get(key)! };
      const accepted = server.receive(input.base, input.change);
      const replica = await SessionReplica.start(await DocxSession.fromBytes(bytes), seq, (value) =>
        DocxSession.fromBytes(value),
      );
      await replica.remote(accepted.change, accepted.seq);
      bytes = await replica.session.toBytes();
      seq = accepted.seq;
      receipts.set(key, seq);
      return { seq };
    },
  };
  return {
    runtime,
    ops: createDocumentOperations(runtime, "test-run"),
    document: () => WordDocument.fromBytes(bytes),
    conflict() {
      rejectCommit = true;
    },
    executor(toolCallId = "script", limits: { timeoutMs?: number; memoryBytes?: number } = {}) {
      return {
        operations: this.ops,
        searchApi: searchDocumentApi,
        state: {},
        toolCallId,
        ...limits,
      };
    },
  };
}

test("agent stages tracked text, formatting, comments and a table as one interoperable OT commit", async () => {
  const f = await fixture();
  const read = await f.ops.inspect({ formatting: true });
  assert.equal(read.seq, 0);
  assert.equal(read.paragraphs[0].text, "The buyer pays within thirty days.");
  const result = await f.ops.apply(
    {
      expectedSeq: 0,
      operations: [
        { op: "replace_text", anchor: { text: "thirty" }, replacement: "sixty" },
        { op: "format_text", anchor: { text: "buyer" }, font: { bold: true, color: "#224466" } },
        { op: "add_comment", anchor: { text: "buyer" }, text: "Confirm this entity." },
        {
          op: "insert_table",
          position: "End",
          values: [
            ["Term", "Value"],
            ["Days", "60"],
          ],
          style: "Table Grid",
          headerRows: 1,
        },
      ],
    },
    "edit-1",
  );
  assert.equal(result.seq, 1);
  const doc = await f.document();
  assert.match(doc.body.text, /within sixty days/);
  assert.equal(doc.body.search("buyer").items[0].font.bold, true);
  assert.equal(doc.body.search("buyer").items[0].font.color, "#224466");
  assert.equal(doc.comments.items[0].authorName, "Clippy");
  assert.equal(doc.comments.items[0].content, "Confirm this entity.");
  assert.deepEqual(doc.tables.items[0].values, [
    ["Term", "Value"],
    ["Days", "60"],
  ]);
  assert.equal(doc.tables.items[0].headerRowCount, 1);
  assert.equal(doc.changeTrackingMode, "Off");
  assert.ok(doc.revisions.items.length >= 3);
  assert.ok(doc.revisions.items.every((revision) => revision.author === "Clippy"));
});

test("a failed later operation and a final CAS conflict both discard the entire staged edit", async () => {
  const f = await fixture();
  await assert.rejects(
    f.ops.apply(
      {
        expectedSeq: 0,
        operations: [
          { op: "replace_text", anchor: { text: "thirty" }, replacement: "sixty" },
          { op: "replace_text", anchor: { text: "absent" }, replacement: "changed" },
        ],
      },
      "rollback",
    ),
    /ANCHOR_COUNT/,
  );
  assert.equal((await f.runtime.snapshot()).seq, 0);
  assert.match((await f.document()).body.text, /thirty days/);
  f.conflict();
  await assert.rejects(
    f.ops.apply(
      {
        expectedSeq: 0,
        operations: [{ op: "replace_text", anchor: { text: "thirty" }, replacement: "sixty" }],
      },
      "conflict",
    ),
    /STALE_DOCUMENT/,
  );
  assert.match((await f.document()).body.text, /thirty days/);
});

test("exact anchors reject ambiguity and stale sequences, and reads explain table coordinates", async () => {
  const f = await fixture("buyer and buyer");
  const found = await f.ops.search({ text: "buyer" });
  assert.equal(found.total, 2);
  await assert.rejects(
    f.ops.apply(
      {
        expectedSeq: 0,
        operations: [
          {
            op: "replace_text",
            anchor: { text: "buyer", expectedMatches: 2 },
            replacement: "seller",
          },
        ],
      },
      "ambiguous",
    ),
    /AMBIGUOUS_ANCHOR/,
  );
  await f.ops.apply(
    {
      expectedSeq: 0,
      operations: [
        {
          op: "replace_text",
          anchor: { text: "buyer", expectedMatches: 2, occurrence: 1 },
          replacement: "seller",
        },
      ],
    },
    "exact",
  );
  assert.equal((await f.document()).body.paragraphs.items[0].text, "buyer and seller");
  await assert.rejects(
    f.ops.apply(
      {
        expectedSeq: 0,
        operations: [{ op: "replace_text", anchor: { text: "seller" }, replacement: "buyer" }],
      },
      "stale",
    ),
    /STALE_DOCUMENT/,
  );
  await f.ops.apply(
    {
      expectedSeq: 1,
      operations: [
        {
          op: "insert_table",
          position: "End",
          values: [
            ["A", "B"],
            ["C", "D"],
          ],
        },
      ],
    },
    "table",
  );
  const table = await f.ops.readTable({ table: 0 });
  assert.deepEqual(
    table.rows[0].cells.map((cell) => [cell.column, cell.ordinal, cell.text, cell.columnSpan]),
    [
      [0, 0, "A", 1],
      [1, 1, "B", 1],
    ],
  );
  await f.ops.apply(
    {
      expectedSeq: 2,
      operations: [
        { op: "set_table_cell", table: 0, row: 1, column: 1, expectedText: "D", text: "E" },
        { op: "format_table", table: 0, expectedRows: 2, expectedColumns: 2, alignment: "Center" },
      ],
    },
    "cell",
  );
  assert.equal((await f.document()).tables.items[0].getCell(1, 1).value, "E");
});

test("header stories, paragraph formats, list creation, comment replies and resolution survive serialization", async () => {
  const f = await fixture();
  await f.ops.apply(
    {
      expectedSeq: 0,
      operations: [
        {
          op: "insert_paragraph",
          scope: { kind: "header", section: 0, variant: "Primary" },
          position: "End",
          text: "Synthetic letterhead",
          format: { font: { bold: true } },
        },
        {
          op: "format_paragraph",
          paragraph: { index: 0, expectedText: "The buyer pays within thirty days." },
          format: { spaceAfter: 12, alignment: "Right" },
        },
        {
          op: "list",
          paragraph: { index: 0, expectedText: "The buyer pays within thirty days." },
          action: "start",
          format: "decimal",
        },
        { op: "add_comment", anchor: { text: "buyer" }, text: "Confirm buyer." },
      ],
    },
    "stories",
  );
  const header = await f.ops.inspect({
    scope: { kind: "header", section: 0, variant: "Primary" },
    formatting: true,
  });
  assert.ok(header.paragraphs.some((p) => p.text === "Synthetic letterhead" && p.font?.bold));
  const comments = await f.ops.review({ kind: "comments" });
  const commentId = (comments.items[0] as { id: string }).id;
  await f.ops.apply(
    {
      expectedSeq: 1,
      operations: [
        { op: "reply_comment", commentId, expectedContent: "Confirm buyer.", text: "Confirmed." },
        { op: "resolve_comment", commentId, expectedContent: "Confirm buyer.", resolved: true },
      ],
    },
    "reply",
  );
  const doc = await f.document();
  assert.equal(doc.body.paragraphs.items[0].spaceAfter, 12);
  assert.equal(doc.body.paragraphs.items[0].isListItem, true);
  assert.equal(doc.comments.items[0].resolved, true);
  assert.equal(doc.comments.items[0].replies.items[0].authorName, "Clippy");
});

test("QuickJS can await document reads, edit atomically, emit output and retain plain state", async () => {
  const f = await fixture();
  const options = f.executor();
  const result = await executeDocumentCode(
    `
    const info = await doc.inspect({limit:10});
    const found = await doc.search({text:'thirty'});
    text({seq:info.seq,matches:found.total});
    text(await doc.apply({expectedSeq:info.seq,operations:[{op:'replace_text',anchor:{text:'thirty'},replacement:'sixty'}]}));
    state.calls = 1;
  `,
    options,
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.committedEdits, 1);
  assert.equal((options.state as { calls?: number }).calls, 1);
  assert.match((await f.document()).body.text, /sixty/);
});

test("QuickJS does not expose Node, fetch, require, host constructors or module loading", async () => {
  const f = await fixture();
  const result = await executeDocumentCode(
    `
    text([typeof process, typeof require, typeof fetch, typeof Buffer, typeof document, typeof global]);
    text(doc.inspect.constructor('return typeof process')());
    text(Function('return typeof require')());
    try { await import('node:fs'); text('unexpected import'); } catch { text('import blocked'); }
  `,
    f.executor(),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.output, [
    ["undefined", "undefined", "undefined", "undefined", "undefined", "undefined"],
    "undefined",
    "undefined",
    "import blocked",
  ]);
  const denied = await executeDocumentCode(
    `await doc.inspect({__proto__: {x:1}, path:'/etc/passwd'});`,
    f.executor("denied"),
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.committedEdits, 0);
});

test("QuickJS interrupts loops and memory abuse and reports prior successful edits after a later error", async () => {
  const f = await fixture();
  const loop = await executeDocumentCode("while(true) {}", f.executor("loop", { timeoutMs: 30 }));
  assert.equal(loop.ok, false);
  assert.match(loop.error ?? "", /interrupted|deadline/);
  const memory = await executeDocumentCode(
    "let a=[]; while(true) a.push(new Array(100000).fill(7));",
    f.executor("memory", { timeoutMs: 1000, memoryBytes: 2 * 1024 * 1024 }),
  );
  assert.equal(memory.ok, false);
  const partial = await executeDocumentCode(
    `
    const info = await doc.inspect({});
    await doc.apply({expectedSeq:info.seq,operations:[{op:'replace_text',anchor:{text:'thirty'},replacement:'sixty'}]});
    throw Error('later failure');
  `,
    f.executor("partial"),
  );
  assert.equal(partial.ok, false);
  assert.equal(partial.committedEdits, 1);
  assert.match(partial.note ?? "", /remain committed/);
  assert.match((await f.document()).body.text, /sixty/);
});
