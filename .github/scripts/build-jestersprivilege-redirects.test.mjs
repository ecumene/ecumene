import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildRedirects } from "./build-jestersprivilege-redirects.mjs";

test("builds canonical redirects from the unified post collection", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "jester-redirects-"));

  try {
    const manifest = await buildRedirects(outputDirectory);
    const redirects = new Map(manifest.map((redirect) => [redirect.key, redirect]));

    assert.equal(redirects.get("index.html")?.destination, "https://mitchellhynes.com/blog");
    assert.equal(redirects.get("about/index.html")?.destination, "https://mitchellhynes.com/about");
    assert.equal(
      redirects.get("blog/25-12-14-end-table/index.html")?.destination,
      "https://mitchellhynes.com/blog/25-12-14-end-table",
    );
    assert.equal(
      redirects.get("devlog/skate-log-10/index.html")?.destination,
      "https://mitchellhynes.com/blog/skate-log-10",
    );
    assert.equal(
      redirects.get("blog/using-mdx/index.html")?.destination,
      "https://mitchellhynes.com/blog",
    );

    const devlogRedirect = redirects.get("devlog/skate-log-10/index.html");
    assert.ok(devlogRedirect);
    const page = await readFile(join(outputDirectory, devlogRedirect.source), "utf8");
    assert.match(page, /http-equiv="refresh"/);
    assert.match(page, /rel="canonical"/);
    assert.match(page, /window\.location\.replace/);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
