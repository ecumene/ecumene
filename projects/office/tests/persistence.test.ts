import assert from "node:assert/strict";
import { mkdtemp, open, readFile, readdir, rm, type FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WordDocument } from "@reductoai/docx/officejs";

import { RoomStore } from "../server/rooms.ts";

test("room creation is not acknowledged until the renamed file directory has been synced", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "office-persistence-"));
  const seed = await WordDocument.create();
  seed.body.paragraphs.items[0].insertText("Synthetic durability fixture.", "Replace");
  const bytes = await seed.toBytes();
  const store = new RoomStore(directory);
  await store.init();
  const probe = await open(directory, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  const originalSync = prototype.sync;
  await probe.close();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reachedDirectory = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let directoryClosed = () => false;
  t.mock.method(prototype, "sync", async function (this: FileHandle) {
    if ((await this.stat()).isDirectory()) {
      directoryClosed = () => this.fd === -1;
      entered();
      await gate;
    }
    await originalSync.call(this);
  });
  const creating = store.create("Synthetic.docx", bytes);
  try {
    const directoryWasFirst = await Promise.race([
      reachedDirectory.then(() => true),
      creating.then(() => false),
    ]);
    assert.equal(
      directoryWasFirst,
      true,
      "the public operation must wait for directory durability",
    );
    assert.equal(
      store.rooms.size,
      0,
      "room must not be published before the durable write finishes",
    );
    const names = await readdir(directory);
    const committed = names.find((name) => name.endsWith(".json"));
    assert.ok(committed, "directory sync must follow the atomic rename");
    assert.equal(names.filter((name) => name.endsWith(".tmp")).length, 0);
    const saved = JSON.parse(await readFile(path.join(directory, committed), "utf8"));
    assert.equal(saved.name, "Synthetic.docx");
    release();
    const room = await creating;
    assert.equal(store.get(room.record.id), room);
    assert.equal(directoryClosed(), true, "directory handle is closed after syncing");
    const restarted = new RoomStore(directory);
    await restarted.init();
    const restored = await WordDocument.fromBytes(restarted.get(room.record.id).bytes);
    assert.equal(restored.body.paragraphs.items[0].text, "Synthetic durability fixture.");
  } finally {
    release();
    await creating.catch(() => {});
    t.mock.restoreAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a directory sync failure rejects the write without publishing it in memory and closes the handle", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "office-persistence-"));
  const store = new RoomStore(directory);
  await store.init();
  const room = await store.create("Synthetic.docx", await (await WordDocument.create()).toBytes());
  const probe = await open(directory, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  const originalSync = prototype.sync;
  await probe.close();
  let directoryClosed = () => false;
  t.mock.method(prototype, "sync", async function (this: FileHandle) {
    if ((await this.stat()).isDirectory()) {
      directoryClosed = () => this.fd === -1;
      throw new Error("Injected directory sync failure");
    }
    await originalSync.call(this);
  });
  try {
    await assert.rejects(
      room.run(() =>
        room.addChat("synthetic-writer", "message-1", "Synthetic Tester", "Synthetic message."),
      ),
      /Injected directory sync failure/,
    );
    assert.equal(room.record.chat.length, 0);
    assert.equal(Object.hasOwn(room.record.chatReceipts, "synthetic-writer:message-1"), false);
    assert.equal(directoryClosed(), true);
    // The rename already happened; a failed sync has an uncertain on-disk
    // outcome. Only the successful durability boundary may be acknowledged.
    t.mock.restoreAll();
    const retried = await room.run(() =>
      room.addChat("synthetic-writer", "message-1", "Synthetic Tester", "Synthetic message."),
    );
    assert.equal(retried.duplicate, false);
    assert.equal(room.record.chat.length, 1);
    const restarted = new RoomStore(directory);
    await restarted.init();
    assert.equal(restarted.get(room.record.id).record.chat.length, 1);
  } finally {
    t.mock.restoreAll();
    await rm(directory, { recursive: true, force: true });
  }
});
