import type { CollabChange } from "@reductoai/docx/collab";
import { DocxSession, SessionReplica } from "@reductoai/docx/editor";
import {
  WordDocument,
  type Body,
  type HeaderFooter,
  type Paragraph,
  type Range,
  type Table,
} from "@reductoai/docx/officejs";
import { tool } from "ai";
import { z } from "zod";

import { executeDocumentCode } from "./document-executor.ts";

export interface DocumentToolRuntime {
  snapshot(): Promise<{ bytes: Uint8Array; seq: number; block: number }>;
  /** The caller serializes this commit and rejects a base that is no longer current. */
  commit(input: {
    runId: string;
    toolCallId: string;
    base: number;
    change: CollabChange;
  }): Promise<{ seq: number }>;
}

const index = z.number().int().min(0).max(100_000);
const text = z.string().max(20_000);
const nonempty = text.min(1);
const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("body") }).strict(),
  z
    .object({
      kind: z.enum(["header", "footer"]),
      section: index,
      variant: z.enum(["Primary", "FirstPage", "EvenPages"]),
    })
    .strict(),
  z.object({ kind: z.enum(["footnote", "endnote"]), index }).strict(),
]);
type Scope = z.infer<typeof scopeSchema>;
const body: Scope = { kind: "body" };
const scope = scopeSchema
  .optional()
  .describe("Default body. Header/footer section and paragraph/table indexes are zero-based.");
const fontSchema = z
  .object({
    name: z.string().max(100).optional(),
    size: z.number().min(1).max(200).optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.enum(["None", "Single", "Double"]).optional(),
    strikeThrough: z.boolean().optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    highlightColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    subscript: z.boolean().optional(),
    superscript: z.boolean().optional(),
  })
  .strict();
const paragraphFormatSchema = z
  .object({
    style: z.string().max(100).optional(),
    alignment: z.enum(["Left", "Center", "Right", "Justified"]).optional(),
    spaceBefore: z.number().min(0).max(300).optional(),
    spaceAfter: z.number().min(0).max(300).optional(),
    leftIndent: z.number().min(-300).max(600).optional(),
    rightIndent: z.number().min(-300).max(600).optional(),
    firstLineIndent: z.number().min(-300).max(600).optional(),
    keepWithNext: z.boolean().optional(),
    keepTogether: z.boolean().optional(),
    rightToLeft: z.boolean().optional(),
    font: fontSchema.optional(),
  })
  .strict();
const paragraphRef = z.object({ index, expectedText: text }).strict();
const anchorSchema = z
  .object({
    text: nonempty,
    paragraph: index.optional(),
    occurrence: index.optional(),
    expectedMatches: z.number().int().min(1).max(1000).default(1),
  })
  .strict()
  .describe(
    "Exact, case-sensitive literal text. Count must match expectedMatches; occurrence is zero-based. Narrow with paragraph when repeated.",
  );
const valuesSchema = z
  .array(z.array(z.string().max(5000)).min(1).max(20))
  .min(1)
  .max(100);
const baseOp = { scope };
const operationSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("replace_text"),
      ...baseOp,
      anchor: anchorSchema,
      replacement: text,
      font: fontSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("insert_text"),
      ...baseOp,
      anchor: anchorSchema,
      text,
      position: z.enum(["Before", "After"]),
      font: fontSchema.optional(),
    })
    .strict(),
  z
    .object({ op: z.literal("format_text"), ...baseOp, anchor: anchorSchema, font: fontSchema })
    .strict(),
  z
    .object({
      op: z.literal("set_hyperlink"),
      ...baseOp,
      anchor: anchorSchema,
      url: z
        .string()
        .url()
        .max(2000)
        .refine((v) => /^https?:/.test(v), "Only HTTP(S) hyperlinks are supported"),
    })
    .strict(),
  z
    .object({
      op: z.literal("insert_paragraph"),
      ...baseOp,
      text,
      position: z.enum(["Start", "End", "Before", "After"]),
      anchor: paragraphRef.optional(),
      format: paragraphFormatSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("format_paragraph"),
      ...baseOp,
      paragraph: paragraphRef,
      format: paragraphFormatSchema,
    })
    .strict(),
  z.object({ op: z.literal("delete_paragraph"), ...baseOp, paragraph: paragraphRef }).strict(),
  z
    .object({
      op: z.literal("page_break"),
      ...baseOp,
      paragraph: paragraphRef,
      position: z.enum(["Before", "After"]),
    })
    .strict(),
  z
    .object({
      op: z.literal("list"),
      ...baseOp,
      paragraph: paragraphRef,
      action: z.enum(["start", "attach", "detach"]),
      format: z
        .enum(["bullet", "decimal", "lowerLetter", "upperLetter", "lowerRoman", "upperRoman"])
        .optional(),
      level: z.number().int().min(0).max(8).optional(),
      listId: index.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("insert_table"),
      ...baseOp,
      values: valuesSchema,
      position: z.enum(["Start", "End", "Before", "After"]),
      anchor: paragraphRef.optional(),
      style: z.string().max(100).optional(),
      headerRows: z.number().int().min(0).max(100).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("set_table_cell"),
      ...baseOp,
      table: index,
      row: index,
      column: index,
      expectedText: text,
      text,
      font: fontSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("format_table"),
      ...baseOp,
      table: index,
      expectedRows: index,
      expectedColumns: index,
      style: z.string().max(100).optional(),
      headerRows: z.number().int().min(0).max(100).optional(),
      alignment: z.enum(["Left", "Center", "Right"]).optional(),
      font: fontSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("add_table_rows"),
      ...baseOp,
      table: index,
      expectedRows: index,
      position: z.enum(["Start", "End"]),
      values: valuesSchema,
    })
    .strict(),
  z
    .object({ op: z.literal("add_comment"), ...baseOp, anchor: anchorSchema, text: nonempty })
    .strict(),
  z
    .object({
      op: z.literal("reply_comment"),
      commentId: z.string().max(80),
      expectedContent: text,
      text: nonempty,
    })
    .strict(),
  z
    .object({
      op: z.literal("resolve_comment"),
      commentId: z.string().max(80),
      expectedContent: text,
      resolved: z.boolean(),
    })
    .strict(),
  z
    .object({
      op: z.literal("settle_revision"),
      revision: index,
      expectedAuthor: z.string().max(200),
      expectedText: text,
      action: z.enum(["accept", "reject"]),
    })
    .strict(),
]);
export const applyDocumentSchema = z
  .object({
    expectedSeq: index,
    operations: z.array(operationSchema).min(1).max(50),
  })
  .strict()
  .describe(
    "All operations stage atomically in order. Indexes refer to the current staged document, so insert/delete can shift later indexes. Changes are tracked as Clippy. A stale sequence commits nothing; read again.",
  );
const readSchema = z
  .object({
    scope,
    start: index.default(0),
    limit: z.number().int().min(1).max(100).default(40),
    formatting: z.boolean().default(false),
  })
  .strict();
const searchSchema = z
  .object({
    scope,
    text: nonempty,
    matchCase: z.boolean().default(true),
    limit: z.number().int().min(1).max(100).default(30),
  })
  .strict();
const tableSchema = z
  .object({
    scope,
    table: index,
    startRow: index.default(0),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
const reviewSchema = z
  .object({
    kind: z.enum(["comments", "revisions"]),
    start: index.default(0),
    limit: z.number().int().min(1).max(100).default(40),
  })
  .strict();
const apiSchema = z.object({ query: z.string().max(300) }).strict();

function story(doc: WordDocument, value: Scope = body): Body | HeaderFooter {
  if (value.kind === "body") return doc.body;
  if ("index" in value) {
    const note = (value.kind === "footnote" ? doc.body.footnotes : doc.body.endnotes).items[
      value.index
    ];
    if (!note) throw new Error(`${value.kind} ${value.index} does not exist.`);
    return note.body;
  }
  const section = doc.sections.items[value.section];
  if (!section) throw new Error(`Section ${value.section} does not exist.`);
  return value.kind === "header"
    ? section.getHeader(value.variant)
    : section.getFooter(value.variant);
}
function paragraph(story: Body | HeaderFooter, ref: z.infer<typeof paragraphRef>): Paragraph {
  const result = story.paragraphs.items[ref.index];
  if (!result || result.text !== ref.expectedText)
    throw new Error(
      `PARAGRAPH_CHANGED: paragraph ${ref.index} no longer contains the exact expected text. Read it again.`,
    );
  return result;
}
function anchor(story: Body | HeaderFooter, ref: z.infer<typeof anchorSchema>): Range {
  const target = ref.paragraph === undefined ? story : story.paragraphs.items[ref.paragraph];
  if (!target) throw new Error("The anchor paragraph does not exist.");
  const matches = target.search(ref.text, { matchCase: true }).items;
  if (matches.length !== ref.expectedMatches)
    throw new Error(
      `ANCHOR_COUNT: expected ${ref.expectedMatches} exact matches, found ${matches.length}. Search and disambiguate before editing.`,
    );
  if (matches.length > 1 && ref.occurrence === undefined)
    throw new Error("AMBIGUOUS_ANCHOR: choose an occurrence or a paragraph.");
  const result = matches[ref.occurrence ?? 0];
  if (!result || result.text !== ref.text)
    throw new Error("ANCHOR_CHANGED: the exact anchor text no longer matches.");
  return result;
}
function tableAt(story: Body | HeaderFooter, index: number): Table {
  const result = story.tables.items[index];
  if (!result) throw new Error(`Table ${index} does not exist.`);
  return result;
}
function formatParagraph(paragraph: Paragraph, format: z.infer<typeof paragraphFormatSchema>) {
  const { font, style, ...properties } = format;
  if (style !== undefined) paragraph.style = style;
  for (const [key, value] of Object.entries(properties)) Reflect.set(paragraph, key, value);
  if (font) paragraph.font.set(font);
}
function dimensions(values: string[][]) {
  const columns = values[0].length;
  if (values.some((row) => row.length !== columns))
    throw new Error("Table values must be rectangular.");
  if (
    values.reduce((sum, row) => sum + row.reduce((sum, value) => sum + value.length, 0), 0) > 40_000
  )
    throw new Error("Table content exceeds 40,000 characters.");
  return { rows: values.length, columns };
}
function applyOperation(
  doc: WordDocument,
  operation: z.infer<typeof operationSchema>,
): Record<string, unknown> {
  if (operation.op === "reply_comment" || operation.op === "resolve_comment") {
    const comment = doc.comments.items.find((value) => value.id === operation.commentId);
    if (!comment || comment.content !== operation.expectedContent)
      throw new Error("COMMENT_CHANGED: read the comments again.");
    if (operation.op === "reply_comment") comment.reply(operation.text);
    else comment.resolved = operation.resolved;
    return { op: operation.op, commentId: comment.id };
  }
  if (operation.op === "settle_revision") {
    const revision = doc.revisions.items[operation.revision];
    if (
      !revision ||
      revision.author !== operation.expectedAuthor ||
      revision.text !== operation.expectedText
    )
      throw new Error("REVISION_CHANGED: read the revisions again.");
    if (operation.action === "accept") revision.accept();
    else revision.reject();
    return { op: operation.op, action: operation.action, author: operation.expectedAuthor };
  }
  const target = story(doc, operation.scope);
  switch (operation.op) {
    case "replace_text":
      anchor(target, operation.anchor).insertText(operation.replacement, "Replace", operation.font);
      break;
    case "insert_text":
      anchor(target, operation.anchor).insertText(
        operation.text,
        operation.position,
        operation.font,
      );
      break;
    case "format_text":
      anchor(target, operation.anchor).font.set(operation.font);
      break;
    case "set_hyperlink":
      anchor(target, operation.anchor).setHyperlink(operation.url);
      break;
    case "insert_paragraph": {
      let created: Paragraph;
      if (operation.position === "Before" || operation.position === "After") {
        if (!operation.anchor)
          throw new Error("Before/After requires an anchor paragraph with expectedText.");
        created = paragraph(target, operation.anchor).insertParagraph(
          operation.text,
          operation.position,
        );
      } else created = target.insertParagraph(operation.text, operation.position);
      if (operation.format) formatParagraph(created, operation.format);
      break;
    }
    case "format_paragraph":
      formatParagraph(paragraph(target, operation.paragraph), operation.format);
      break;
    case "delete_paragraph":
      paragraph(target, operation.paragraph).delete();
      break;
    case "page_break":
      paragraph(target, operation.paragraph).insertBreak("Page", operation.position);
      break;
    case "list": {
      const item = paragraph(target, operation.paragraph);
      if (operation.action === "detach") item.detachFromList();
      else if (operation.action === "attach") {
        if (operation.listId === undefined)
          throw new Error("Attaching requires a listId from read_document.");
        item.attachToList(operation.listId, operation.level ?? 0);
      } else item.startNewList(operation.format ?? "bullet", operation.level ?? 0);
      break;
    }
    case "insert_table": {
      const { rows, columns } = dimensions(operation.values);
      let created: Table;
      if (operation.position === "Before" || operation.position === "After") {
        if (!operation.anchor)
          throw new Error("Before/After requires an anchor paragraph with expectedText.");
        created = paragraph(target, operation.anchor).insertTable(
          rows,
          columns,
          operation.position,
          operation.values,
        );
      } else created = target.insertTable(rows, columns, operation.position, operation.values);
      if (operation.style) created.style = operation.style;
      if (operation.headerRows !== undefined) {
        if (operation.headerRows > rows) throw new Error("Header rows exceed table rows.");
        created.headerRowCount = operation.headerRows;
      }
      break;
    }
    case "set_table_cell": {
      const cell = tableAt(target, operation.table).getCell(operation.row, operation.column);
      if (cell.value !== operation.expectedText)
        throw new Error("CELL_CHANGED: read the table again.");
      cell.value = operation.text;
      if (operation.font) cell.font.set(operation.font);
      break;
    }
    case "format_table": {
      const table = tableAt(target, operation.table);
      if (
        table.rowCount !== operation.expectedRows ||
        table.columnCount !== operation.expectedColumns
      )
        throw new Error("TABLE_CHANGED: read the table again.");
      if (operation.style) table.style = operation.style;
      if (operation.headerRows !== undefined) {
        if (operation.headerRows > table.rowCount)
          throw new Error("Header rows exceed table rows.");
        table.headerRowCount = operation.headerRows;
      }
      if (operation.alignment)
        table.alignment = operation.alignment === "Center" ? "Centered" : operation.alignment;
      if (operation.font) table.font.set(operation.font);
      break;
    }
    case "add_table_rows": {
      const table = tableAt(target, operation.table);
      if (table.rowCount !== operation.expectedRows)
        throw new Error("TABLE_CHANGED: read the table again.");
      dimensions(operation.values);
      table.addRows(operation.position, operation.values.length, operation.values);
      break;
    }
    case "add_comment":
      return {
        op: operation.op,
        commentId: anchor(target, operation.anchor).insertComment(operation.text).id,
      };
  }
  return { op: operation.op, scope: operation.scope ?? body };
}

/** Human-readable recipes for the exposed contract, not vendor source or an arbitrary reflection bridge. */
const recipes = [
  {
    name: "read_document",
    topics: "inspect read paragraphs formatting metadata styles sections headers footers lists",
    usage: 'read_document({scope:{kind:"body"},start:0,limit:40,formatting:true})',
    detail:
      "Returns seq, exact paragraph text, scope-local paragraph indexes, table counts, styles, section count, protection and review counts. Body paragraphs include table cells. Header/footer scopes require section and variant. Read results are bounded; continue with nextStart.",
  },
  {
    name: "search_document",
    topics: "find search exact literal anchors repeated text",
    usage: 'search_document({text:"the buyer",matchCase:true})',
    detail:
      "Returns seq, total matches and bounded hits with paragraph index and offsets. Search is story-scoped. Edits require exact case-sensitive text plus expectedMatches and occurrence when ambiguous.",
  },
  {
    name: "read_table",
    topics: "tables cells merged grids rows columns",
    usage: "read_table({table:0,startRow:0,limit:20})",
    detail:
      "Table and cell indexes are zero-based. Each cell includes logical column and physical ordinal, spans and exact text. set_table_cell addresses the logical column. Never infer logical columns from a values array on merged tables.",
  },
  {
    name: "read_review",
    topics: "comments replies resolve revisions redlines tracked changes accept reject",
    usage: 'read_review({kind:"comments",start:0,limit:40})',
    detail:
      "Comments have IDs; revision indexes are valid only at the returned seq. settle_revision also requires expectedAuthor and expectedText. Do not settle other authors’ revisions unless the user requests it.",
  },
  {
    name: "replace_text / insert_text",
    topics: "edit delete replace insert text anchor",
    usage:
      'apply_document_edits({expectedSeq:0,operations:[{op:"replace_text",anchor:{text:"thirty",expectedMatches:1},replacement:"sixty"}]})',
    detail:
      "An empty replacement deletes the matched text. insert_text uses Before/After. Scope and optional paragraph narrow the anchor. Repeated anchors require expectedMatches and occurrence. A batch commits only if every operation succeeds and the sequence is unchanged.",
  },
  {
    name: "format_text / format_paragraph",
    topics:
      "font bold italic underline color highlight size indent spacing heading style alignment",
    usage:
      'apply_document_edits({expectedSeq:0,operations:[{op:"format_paragraph",paragraph:{index:0,expectedText:"Introduction"},format:{style:"Heading 1",spaceAfter:12,font:{bold:true}}}]})',
    detail:
      "Paragraph format supports style, alignment, spaceBefore/After, indents, keepWithNext/keepTogether, rightToLeft, font. Font supports name,size,bold,italic,underline,strikeThrough,color,highlightColor,subscript,superscript. Hex colors include #. False explicitly clears a toggle. Styles can alter direct formatting; do not use style switches to merely bold text.",
  },
  {
    name: "insert_paragraph / delete_paragraph / page_break / list",
    topics: "paragraphs append prepend headings numbered bullet lists page breaks",
    usage:
      'apply_document_edits({expectedSeq:0,operations:[{op:"insert_paragraph",position:"End",text:"New clause",format:{style:"Normal"}}]})',
    detail:
      "Before/After requires anchor:{index,expectedText}. Start/End are story boundaries. Paragraph insertion inherits edge formatting; provide format when needed. list starts, attaches by listId, or detaches. Page breaks use a paragraph ref and Before/After. Indexes shift as a batch runs.",
  },
  {
    name: "insert_table / set_table_cell / format_table / add_table_rows",
    topics: "table insert fill row format headers grid cell",
    usage:
      'apply_document_edits({expectedSeq:0,operations:[{op:"insert_table",position:"End",values:[["Term","Value"],["Days","60"]],style:"Table Grid",headerRows:1}]})',
    detail:
      "Rectangular input values; maximum 100 rows × 20 columns. set_table_cell requires exact expectedText. format_table requires expectedRows/expectedColumns and supports style/headerRows/alignment/font. add_table_rows requires expectedRows, Start/End and values.",
  },
  {
    name: "add_comment / reply_comment / resolve_comment / settle_revision",
    topics: "review comment discuss redline revision accept reject",
    usage:
      'apply_document_edits({expectedSeq:0,operations:[{op:"add_comment",anchor:{text:"buyer",expectedMatches:1},text:"Confirm the legal entity."}]})',
    detail:
      "Changes and comments are attributed to Clippy. Replies/resolution require commentId and expectedContent. Edits create tracked changes while preserving the document’s existing tracking setting afterward. Revision settlement is targeted; no implicit accept-all or reject-all.",
  },
  {
    name: "exec",
    topics: "javascript programmatic loops batch tools sandbox automation",
    usage: "const r = await doc.inspect({limit:20}); text(r);",
    detail:
      "Isolated JavaScript with JSON-only doc.inspect/search/readTable/review/apply, api.search, text and plain state. No Node, process, require, filesystem, fetch, imports or host object handles. doc.apply is the same guarded typed batch; earlier successful calls remain committed if later code fails. Prefer one apply batch for atomicity.",
  },
];
export function searchDocumentApi(input: unknown) {
  const { query } = apiSchema.parse(input);
  const words = query.toLowerCase().split(/\W+/).filter(Boolean);
  return recipes
    .map((recipe) => ({
      recipe,
      score: words.reduce(
        (sum, word) =>
          sum +
          (`${recipe.name} ${recipe.topics} ${recipe.detail}`.toLowerCase().includes(word) ? 1 : 0),
        0,
      ),
    }))
    .filter((entry) => !words.length || entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((entry) => entry.recipe);
}

function clipped(value: string, limit = 5000) {
  return { text: value.slice(0, limit), truncated: value.length > limit };
}
function bounded<T>(value: T): T {
  if (JSON.stringify(value).length > 64_000)
    throw new Error("OUTPUT_LIMIT: request fewer paragraphs/rows or disable formatting.");
  return value;
}

export function createDocumentOperations(runtime: DocumentToolRuntime, runId: string) {
  async function open() {
    const snapshot = await runtime.snapshot();
    return { ...snapshot, doc: await WordDocument.fromBytes(snapshot.bytes) };
  }
  return {
    async inspect(input: unknown) {
      const args = readSchema.parse(input);
      const { doc, seq } = await open();
      const target = story(doc, args.scope);
      const paragraphs = target.paragraphs.items;
      const end = Math.min(paragraphs.length, args.start + args.limit);
      return bounded({
        seq,
        scope: args.scope ?? body,
        paragraphCount: paragraphs.length,
        tableCount: target.tables.items.length,
        paragraphs: paragraphs.slice(args.start, end).map((p, offset) => ({
          index: args.start + offset,
          ...clipped(p.text),
          style: p.style,
          ...(p.isListItem ? { listId: p.list.id, listLevel: p.listItem.level } : {}),
          ...(args.formatting
            ? {
                font: p.font.toJSON(),
                alignment: p.alignment,
                spaceBefore: p.spaceBefore,
                spaceAfter: p.spaceAfter,
                leftIndent: p.leftIndent,
                rightIndent: p.rightIndent,
                firstLineIndent: p.firstLineIndent,
              }
            : {}),
        })),
        nextStart: end < paragraphs.length ? end : null,
        document: {
          sections: doc.sections.items.length,
          comments: doc.comments.items.length,
          revisions: doc.revisions.items.length,
          trackingMode: doc.changeTrackingMode,
          protection: doc.protectionType,
          styles: doc.styles.slice(0, 150),
          footnotes: doc.body.footnotes.items.length,
          endnotes: doc.body.endnotes.items.length,
          fields: doc.body.fields.items.length,
          pictures: doc.body.inlinePictures.items.length,
        },
      });
    },
    async search(input: unknown) {
      const args = searchSchema.parse(input);
      const { doc, seq } = await open();
      const target = story(doc, args.scope);
      const paragraphs = target.paragraphs.items;
      const hits = target.search(args.text, { matchCase: args.matchCase }).items;
      return bounded({
        seq,
        scope: args.scope ?? body,
        total: hits.length,
        hits: hits.slice(0, args.limit).map((hit, occurrence) => ({
          occurrence,
          text: hit.text,
          paragraph: paragraphs.findIndex((p) => p.element === hit.paragraph.element),
          start: hit.start,
          end: hit.end,
          context: clipped(hit.paragraph.text, 1000),
        })),
        truncated: hits.length > args.limit,
      });
    },
    async readTable(input: unknown) {
      const args = tableSchema.parse(input);
      const { doc, seq } = await open();
      const table = tableAt(story(doc, args.scope), args.table);
      const rows = table.rows.items;
      const end = Math.min(rows.length, args.startRow + args.limit);
      return bounded({
        seq,
        scope: args.scope ?? body,
        table: args.table,
        rowCount: table.rowCount,
        columnCount: table.columnCount,
        style: table.style,
        headerRows: table.headerRowCount,
        rows: rows.slice(args.startRow, end).map((row, offset) => ({
          index: args.startRow + offset,
          cells: row.cells.items.map((cell) => ({
            column: cell.cellIndex,
            ordinal: cell.cellOrdinal,
            columnSpan: cell.columnSpan,
            rowSpan: cell.rowSpan,
            ...clipped(cell.value),
          })),
        })),
        nextStart: end < rows.length ? end : null,
      });
    },
    async review(input: unknown) {
      const args = reviewSchema.parse(input);
      const { doc, seq } = await open();
      const all =
        args.kind === "comments"
          ? doc.comments.items.map((comment) => comment.toJSON())
          : doc.revisions.items.map((revision, index) => ({
              index,
              ...revision.toJSON(),
              story: revision.storyType,
            }));
      const end = Math.min(all.length, args.start + args.limit);
      return bounded({
        seq,
        kind: args.kind,
        total: all.length,
        items: all.slice(args.start, end),
        nextStart: end < all.length ? end : null,
      });
    },
    async apply(input: unknown, toolCallId: string) {
      const args = applyDocumentSchema.parse(input);
      if (JSON.stringify(args).length > 100_000)
        throw new Error("INPUT_LIMIT: edit batch exceeds 100,000 characters.");
      const snapshot = await runtime.snapshot();
      if (snapshot.seq !== args.expectedSeq)
        throw new Error(
          `STALE_DOCUMENT: expected seq ${args.expectedSeq}, current seq ${snapshot.seq}. Read again; nothing was changed.`,
        );
      const replica = await SessionReplica.start(
        await DocxSession.fromBytes(snapshot.bytes),
        snapshot.seq,
        (bytes) => DocxSession.fromBytes(bytes),
        snapshot.block,
      );
      const doc = WordDocument.from(replica.session);
      if (doc.protectionType !== "NoProtection")
        throw new Error(
          `PROTECTED_DOCUMENT: ${doc.protectionType}; the coworker will not bypass document protection.`,
        );
      const savedTracking = doc.changeTrackingMode;
      doc.revisionAuthor = "Clippy";
      doc.changeTrackingMode = "TrackAll";
      const results = args.operations.map((operation) => applyOperation(doc, operation));
      doc.changeTrackingMode = savedTracking;
      const change = await replica.commit();
      if (!change) return { seq: snapshot.seq, changed: false, results };
      const accepted = await runtime.commit({ runId, toolCallId, base: snapshot.seq, change });
      return { seq: accepted.seq, changed: true, tracked: true, results };
    },
  };
}

export function createDocumentTools(runtime: DocumentToolRuntime, runId: string) {
  const operations = createDocumentOperations(runtime, runId);
  const state: Record<string, unknown> = {};
  return {
    read_document: tool({
      description:
        "Read a bounded page of paragraphs, exact text anchors, styles, formatting, document structure and current sequence. Scope defaults to body; headers/footers are explicit. Start here before edits.",
      inputSchema: readSchema,
      execute: (input) => operations.inspect(input),
    }),
    search_document: tool({
      description:
        "Literal text search in a body/header/footer story. Returns exact matches, occurrence and paragraph indexes at the current sequence.",
      inputSchema: searchSchema,
      execute: (input) => operations.search(input),
    }),
    read_table: tool({
      description:
        "Inspect table rows and cells, including logical columns, physical ordinals and merge spans. Read before cell edits.",
      inputSchema: tableSchema,
      execute: (input) => operations.readTable(input),
    }),
    read_review: tool({
      description:
        "Read comments/replies or tracked revisions with IDs/indexes and authors. Paginated; does not settle revisions.",
      inputSchema: reviewSchema,
      execute: (input) => operations.review(input),
    }),
    apply_document_edits: tool({
      description:
        "Atomically stage a bounded batch of exact-anchor text edits, formatting, paragraphs, lists, tables, comments, or targeted revision decisions. Requires current seq. Clippy changes are tracked. Any failure before commit changes nothing.",
      inputSchema: applyDocumentSchema,
      execute: (input, options) => operations.apply(input, options.toolCallId),
    }),
    search_document_api: tool({
      description:
        "Find supported document API recipes and constraints. This describes the typed tools exposed here; it does not execute code or expose arbitrary package methods.",
      inputSchema: apiSchema,
      execute: async (input) => searchDocumentApi(input),
    }),
    exec: tool({
      description:
        "Run bounded JavaScript in a QuickJS WASM isolate. Prebound JSON-only async doc.inspect/search/readTable/review/apply, api.search, text(value), and plain state. No Node, imports, network or filesystem. Earlier successful apply calls remain committed if later code errors; use one apply batch for atomic changes.",
      inputSchema: z.object({ code: z.string().min(1).max(20_000) }).strict(),
      execute: (input, options) =>
        executeDocumentCode(input.code, {
          operations,
          searchApi: searchDocumentApi,
          state,
          toolCallId: options.toolCallId,
          signal: options.abortSignal,
        }),
    }),
  };
}
