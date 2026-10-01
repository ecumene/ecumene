#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [policyPath, sourceDirectory] = process.argv.slice(2);
if (!policyPath || !sourceDirectory) {
  console.error("Usage: upload-halo-static.mjs <upload-policy.json> <build-directory>");
  process.exit(2);
}

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json"],
  [".map", "application/octet-stream"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
]);

async function filesBelow(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await filesBelow(absolute, relative));
    } else if (entry.isFile() && entry.name !== ".DS_Store") {
      files.push({ absolute, relative });
    }
  }
  return files;
}

const policy = JSON.parse(await readFile(policyPath, "utf8"));
const keyTemplate = policy.fields?.key;
if (!policy.url || !keyTemplate || !keyTemplate.includes("${filename}")) {
  throw new Error("The upload policy is missing its URL or filename-scoped key.");
}

const files = await filesBelow(path.resolve(sourceDirectory));
let completed = 0;
let cursor = 0;

async function upload(file) {
  const form = new FormData();
  for (const [name, value] of Object.entries(policy.fields)) {
    if (name !== "key") form.append(name, value);
  }
  const key = keyTemplate.replace("${filename}", file.relative);
  const type = mimeTypes.get(path.extname(file.relative).toLowerCase()) ||
    "application/octet-stream";
  form.append("key", key);
  form.append("Content-Type", type);
  form.append("file", new Blob([await readFile(file.absolute)], { type }), path.basename(file.relative));

  const response = await fetch(policy.url, { method: "POST", body: form });
  if (!response.ok) {
    throw new Error(`Upload failed for ${file.relative}: ${response.status} ${await response.text()}`);
  }
  completed += 1;
  console.log(`[${completed}/${files.length}] ${file.relative}`);
}

async function worker() {
  while (cursor < files.length) {
    const file = files[cursor++];
    await upload(file);
  }
}

await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
console.log(`Uploaded ${files.length} Halo preview files.`);
