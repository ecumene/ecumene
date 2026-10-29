import assert from "node:assert/strict";
import test from "node:test";

import { WordDocument } from "@reductoai/docx/officejs";
import JSZip from "jszip";

import { createLayoutTools, type LayoutToolRuntime } from "../server/layout-tools.ts";

const context = { toolCallId: "synthetic-page-test", messages: [], context: {} };
async function fixture() {
  const doc = await WordDocument.create();
  doc.body.paragraphs.items[0].insertText("Synthetic first page heading.", "Replace");
  doc.body.paragraphs.items[0].font.set({ name: "Arial", size: 18, bold: true });
  doc.body.insertParagraph("Only the first page contains the word apricot.", "End");
  const second = doc.body.insertParagraph("Synthetic second page heading.", "End");
  second.insertBreak("Page", "Before");
  doc.body.insertParagraph("Only the second page contains the word blueberry.", "End");
  doc.body.insertTable(2, 2, "End", [
    ["Term", "Value"],
    ["Synthetic count", "42"],
  ]);
  doc.sections.items[0].getHeader("Primary").insertParagraph("Synthetic running header", "End");
  doc.sections.items[0].getFooter("Primary").insertParagraph("Synthetic running footer", "End");
  const bytes = await doc.toBytes();
  const runtime: LayoutToolRuntime = {
    async snapshot() {
      return { bytes, seq: 7, block: 3 };
    },
  };
  return { bytes, runtime, tools: createLayoutTools(runtime) };
}

test("same-engine page reads include physical geometry, table cells, stories and the exact room revision", async () => {
  const { tools, bytes } = await fixture();
  const original = Buffer.from(bytes);
  const first = await tools.read_page.execute!({ page: 1, lineOffset: 0, lineLimit: 100 }, context);
  assert.ok("lines" in first);
  assert.equal(first.seq, 7);
  assert.equal(first.block, 3);
  assert.equal(first.pageCount, 2);
  assert.equal(first.page, 1);
  assert.equal(first.unit, "pt");
  assert.equal(first.width, 612);
  assert.equal(first.height, 792);
  assert.match(first.lines.map((line) => line.text).join("\n"), /apricot/);
  assert.doesNotMatch(first.lines.map((line) => line.text).join("\n"), /blueberry/);
  assert.ok(
    first.lines.some((line) => line.story === "header" && line.text.includes("running header")),
  );
  assert.ok(
    first.lines.some((line) => line.story === "footer" && line.text.includes("running footer")),
  );
  assert.ok(
    first.lines
      .filter((line) => line.text)
      .every((line) => Number.isFinite(line.x) && Number.isFinite(line.y) && line.height > 0),
  );

  const second = await tools.read_page.execute!(
    { page: 2, expectedSeq: 7, lineOffset: 0, lineLimit: 100 },
    context,
  );
  assert.ok("lines" in second);
  assert.equal(second.pageCount, 2);
  assert.match(second.lines.map((line) => line.text).join("\n"), /blueberry/);
  assert.ok(
    second.lines.some(
      (line) =>
        line.text === "42" &&
        line.source?.kind === "table-cell" &&
        line.source.row === 1 &&
        line.source.col === 1,
    ),
  );
  assert.equal(second.tableCount, 1);
  assert.equal(second.tables[0].rows, 2);
  assert.equal(second.tables[0].columns, 2);
  assert.ok(second.tables[0].width > 0 && second.tables[0].height > 0);
  assert.deepEqual(Buffer.from(bytes), original, "page inspection does not mutate snapshot bytes");
  assert.doesNotMatch(JSON.stringify(second), /sourcePath|\/Users\/|dataB64|faceManifest/);
});

test("bounded line windows can be continued without losing or repeating physical lines", async () => {
  const { tools } = await fixture();
  const full = await tools.read_page.execute!({ page: 2, lineOffset: 0, lineLimit: 100 }, context);
  const head = await tools.read_page.execute!({ page: 2, lineOffset: 0, lineLimit: 2 }, context);
  assert.ok("lines" in full && "lines" in head);
  assert.equal(head.lines.length, 2);
  assert.equal(head.nextLineOffset, 2);
  const tail = await tools.read_page.execute!(
    { page: 2, lineOffset: head.nextLineOffset!, lineLimit: 100 },
    context,
  );
  assert.ok("lines" in tail);
  assert.deepEqual([...head.lines, ...tail.lines], full.lines);
  assert.equal(tail.nextLineOffset, null);
});

test("render_page supplies a real PNG file part to the model while logs contain metadata only", async () => {
  const { tools } = await fixture();
  const input = { page: 2, expectedSeq: 7, scale: 1 };
  const output = await tools.render_page.execute!(input, context);
  assert.ok("status" in output);
  assert.equal(output.status, "rendered", JSON.stringify(output));
  assert.ok(output.status === "rendered");
  assert.equal(output.pixelWidth, 816);
  assert.equal(output.pixelHeight, 1056);
  assert.equal(output.seq, 7);
  const persisted = JSON.stringify({ input, output });
  assert.ok(persisted.length < 3000);
  assert.doesNotMatch(persisted, /iVBOR|dataB64|Uint8Array|"png"|"data"|"buffer"/);
  const model = await tools.render_page.toModelOutput!({
    toolCallId: context.toolCallId,
    input,
    output,
  });
  assert.equal(model.type, "content");
  assert.ok(model.type === "content");
  const file = model.value.find((part) => part.type === "file");
  assert.ok(
    file?.type === "file" && file.data.type === "data" && file.data.data instanceof Uint8Array,
  );
  assert.equal(file.mediaType, "image/png");
  assert.equal(file.filename, "page-2.png");
  const png = Buffer.from(file.data.data);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), output.pixelWidth);
  assert.equal(png.readUInt32BE(20), output.pixelHeight);
  assert.ok(png.byteLength > 1000 && png.byteLength < 8 * 1024 * 1024);
  assert.equal(
    JSON.stringify({ input, output }),
    persisted,
    "conversion does not attach binary fields to the persisted result",
  );

  // Only two transient images are retained; expired metadata must never claim
  // that the model received an image after it has been evicted.
  for (const page of [1, 2]) await tools.render_page.execute!({ page, scale: 0.5 }, context);
  const expired = await tools.render_page.toModelOutput!({
    toolCallId: context.toolCallId,
    input,
    output,
  });
  assert.ok(expired.type === "text");
  assert.match(expired.value, /transient page image expired/);
  assert.match(expired.value, /"status":"unavailable"/);
});

test("invalid page/path inputs, stale revisions and absent pages fail explicitly", async () => {
  const { tools } = await fixture();
  await assert.rejects(async () =>
    tools.read_page.execute!({ page: 0, lineOffset: 0, lineLimit: 1 }, context),
  );
  await assert.rejects(async () =>
    tools.read_page.execute!(
      { page: 1, path: "/not-a-document", lineOffset: 0, lineLimit: 1 } as never,
      context,
    ),
  );
  await assert.rejects(
    async () =>
      tools.read_page.execute!({ page: 1, expectedSeq: 6, lineOffset: 0, lineLimit: 1 }, context),
    /STALE_DOCUMENT/,
  );
  await assert.rejects(
    async () => tools.read_page.execute!({ page: 3, lineOffset: 0, lineLimit: 1 }, context),
    /PAGE_NOT_FOUND.*document has 2 pages/,
  );
});

test("a hard worker deadline and cancellation do not leave the tool busy or alter the document", async () => {
  const { runtime } = await fixture();
  const bounded = createLayoutTools(runtime, { timeoutMs: 1 });
  await assert.rejects(
    async () => bounded.read_page.execute!({ page: 1, lineOffset: 0, lineLimit: 1 }, context),
    /LAYOUT_TIMEOUT/,
  );
  await assert.rejects(
    async () => bounded.read_page.execute!({ page: 1, lineOffset: 0, lineLimit: 1 }, context),
    /LAYOUT_TIMEOUT/,
  );
  const controller = new AbortController();
  const tools = createLayoutTools(runtime);
  const pending = tools.read_page.execute!(
    { page: 1, lineOffset: 0, lineLimit: 1 },
    { ...context, abortSignal: controller.signal },
  );
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(async () => pending, /LAYOUT_CANCELLED/);
  const after = await tools.read_page.execute!({ page: 1, lineOffset: 0, lineLimit: 1 }, context);
  assert.ok("lines" in after);
  assert.equal(after.seq, 7);
  assert.equal(after.lines.length, 1);
});

test("a document beyond the page cap is rejected instead of reporting a false complete page count", async () => {
  const original = await WordDocument.create();
  const zip = await JSZip.loadAsync(await original.toBytes());
  const xml = await zip.file("word/document.xml")!.async("string");
  const paragraphs = Array.from(
    { length: 201 },
    (_, index) =>
      `<w:p>${index ? "<w:pPr><w:pageBreakBefore/></w:pPr>" : ""}<w:r><w:t>Synthetic page ${index + 1}</w:t></w:r></w:p>`,
  ).join("");
  const section = xml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0] ?? "";
  zip.file(
    "word/document.xml",
    xml.replace(/<w:body\b[^>]*>[\s\S]*?<\/w:body>/, `<w:body>${paragraphs}${section}</w:body>`),
  );
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const tools = createLayoutTools({
    async snapshot() {
      return { bytes, seq: 0, block: 0 };
    },
  });
  await assert.rejects(
    async () => tools.read_page.execute!({ page: 1, lineOffset: 0, lineLimit: 1 }, context),
    /PAGE_LIMIT.*complete pagination was not computed/,
  );
});
