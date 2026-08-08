import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultPostsDirectory = resolve(rootDirectory, "apps/mitchellhynes.com/src/content/posts");

const fixedRedirects = [
  ["index.html", "https://mitchellhynes.com/blog"],
  ["blog", "https://mitchellhynes.com/blog"],
  ["blog/index.html", "https://mitchellhynes.com/blog"],
  ["devlog", "https://mitchellhynes.com/blog"],
  ["devlog/index.html", "https://mitchellhynes.com/blog"],
  ["about", "https://mitchellhynes.com/about"],
  ["about/index.html", "https://mitchellhynes.com/about"],
  ["rss.xml", "https://mitchellhynes.com/rss.xml"],
  ["sitemap-0.xml", "https://mitchellhynes.com/sitemap-0.xml"],
  ["sitemap-index.xml", "https://mitchellhynes.com/sitemap-index.xml"],
];

const readPostMetadata = (source, filename) => {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) throw new Error(`Missing frontmatter in ${filename}`);

  const kind = frontmatter[1].match(/^kind:\s*["']?(blog|devlog)["']?\s*$/m)?.[1];
  if (!kind) throw new Error(`Missing blog or devlog kind in ${filename}`);

  return {
    kind,
    draft: /^draft:\s*true\s*$/m.test(frontmatter[1]),
  };
};

export const createRedirectDocument = (destination) => {
  const escapedDestination = destination
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <meta http-equiv="refresh" content="0; url=${escapedDestination}">
    <link rel="canonical" href="${escapedDestination}">
    <title>Moved to Mitchell Hynes</title>
    <script>window.location.replace(${JSON.stringify(destination)} + window.location.search + window.location.hash);</script>
  </head>
  <body>
    <p>This page moved to <a href="${escapedDestination}">${escapedDestination}</a>.</p>
  </body>
</html>
`;
};

export const buildRedirects = async (outputDirectory, postsDirectory = defaultPostsDirectory) => {
  const redirects = new Map(fixedRedirects);
  const postFiles = (await readdir(postsDirectory)).filter((file) => file.endsWith(".mdx"));

  for (const filename of postFiles) {
    const source = await readFile(resolve(postsDirectory, filename), "utf8");
    const { kind, draft } = readPostMetadata(source, filename);
    const slug = filename.replace(/\.mdx$/, "");
    const legacyDirectory = kind === "devlog" ? "devlog" : "blog";
    const destination = draft
      ? "https://mitchellhynes.com/blog"
      : `https://mitchellhynes.com/blog/${slug}`;

    redirects.set(`${legacyDirectory}/${slug}`, destination);
    redirects.set(`${legacyDirectory}/${slug}/index.html`, destination);
  }

  await rm(outputDirectory, { recursive: true, force: true });

  const manifest = [...redirects]
    .map(([key, destination]) => ({ key, destination }))
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((redirect, index) => ({
      ...redirect,
      source: `objects/${String(index).padStart(3, "0")}.html`,
    }));

  for (const { source, destination } of manifest) {
    const outputPath = resolve(outputDirectory, source);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, createRedirectDocument(destination));
  }

  await writeFile(
    resolve(outputDirectory, "redirects.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  return manifest;
};

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  const outputDirectory = process.argv[2];
  if (!outputDirectory) throw new Error("Pass an output directory for the redirect objects");

  const manifest = await buildRedirects(resolve(outputDirectory));
  console.log(`Built ${manifest.length} Jester redirect objects.`);
}
