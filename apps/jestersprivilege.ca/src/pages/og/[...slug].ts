import { getCollection } from "astro:content";
import { OGImageRoute } from "astro-og-canvas";

const blogEntries = await getCollection("blog");

const pages = Object.fromEntries(
  blogEntries.map(({ slug, data }) => [slug, data]),
);

export const { getStaticPaths, GET } = OGImageRoute({
  param: "slug",
  pages,
  getImageOptions: (_path, page) => ({
    title: page.title,
    description: page.description,
    logo: {
      path: "./public/jester1.png",
      size: [100],
    },
    bgGradient: [[255, 255, 255]],
    border: {
      color: [207, 182, 90],
      width: 20,
      side: "inline-start",
    },
    padding: 60,
    font: {
      title: {
        families: ["EB Garamond", "Georgia", "serif"],
        weight: "Normal",
        color: [18, 18, 19],
        size: 72,
      },
      description: {
        families: ["EB Garamond", "Georgia", "serif"],
        weight: "Normal",
        color: [80, 80, 80],
        size: 36,
      },
    },
    fonts: [
      "https://cdn.jsdelivr.net/fontsource/fonts/eb-garamond@latest/latin-400-normal.ttf",
    ],
  }),
});
