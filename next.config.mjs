// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: {
    globalObject: "this",
  },
  experimental: {
    appDir: true,
    mdxRs: false,
  },
};

import remarkFrontmatter from "remark-frontmatter";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import rehypePrettyCode from "rehype-pretty-code";
// import remarkGfm from "remark-gfm";
import nextMDX from "@next/mdx";

const withMDX = nextMDX({
  options: {
    remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter],
    rehypePlugins: [[rehypePrettyCode]],
  },
});

export default withMDX(nextConfig);
