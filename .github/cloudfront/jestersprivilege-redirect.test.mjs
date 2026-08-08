import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script, createContext } from "node:vm";

const source = readFileSync(new URL("./jestersprivilege-redirect.js", import.meta.url), "utf8");
const context = createContext({});
new Script(`${source}\nthis.handleRedirect = handler;`).runInContext(context);

const request = (uri) => ({
  request: {
    uri,
    method: "GET",
    headers: {},
    querystring: {},
  },
});

const redirectLocation = (uri) => context.handleRedirect(request(uri)).headers.location.value;

test("redirects the old directories to the canonical site", () => {
  assert.equal(redirectLocation("/"), "https://mitchellhynes.com/blog");
  assert.equal(redirectLocation("/blog/"), "https://mitchellhynes.com/blog");
  assert.equal(redirectLocation("/devlog"), "https://mitchellhynes.com/blog");
  assert.equal(redirectLocation("/about"), "https://mitchellhynes.com/about");
  assert.equal(redirectLocation("/rss.xml"), "https://mitchellhynes.com/rss.xml");
  assert.equal(
    redirectLocation("/sitemap-index.xml"),
    "https://mitchellhynes.com/sitemap-index.xml",
  );
});

test("moves blog and devlog posts into the unified blog route", () => {
  assert.equal(
    redirectLocation("/blog/25-12-14-end-table"),
    "https://mitchellhynes.com/blog/25-12-14-end-table",
  );
  assert.equal(
    redirectLocation("/devlog/skate-log-10/index.html"),
    "https://mitchellhynes.com/blog/skate-log-10",
  );
});

test("does not publish the old draft route", () => {
  assert.equal(redirectLocation("/blog/using-mdx"), "https://mitchellhynes.com/blog");
});

test("preserves query parameters on redirects", () => {
  const event = request("/blog/25-12-14-end-table");
  event.request.querystring = {
    source: { value: "old site" },
    tag: { multiValue: [{ value: "wood" }, { value: "work" }] },
  };

  assert.equal(
    context.handleRedirect(event).headers.location.value,
    "https://mitchellhynes.com/blog/25-12-14-end-table?source=old%20site&tag=wood&tag=work",
  );
});

test("leaves legacy assets on the Jester origin", () => {
  const assetRequest = request("/woodworking/end-table.webp");
  assert.equal(context.handleRedirect(assetRequest), assetRequest.request);

  const socialImageRequest = request("/og/25-12-14-end-table.png");
  assert.equal(context.handleRedirect(socialImageRequest), socialImageRequest.request);

  const blogImageRequest = request("/blog/the-more-things-change.png");
  assert.equal(context.handleRedirect(blogImageRequest), blogImageRequest.request);
});
