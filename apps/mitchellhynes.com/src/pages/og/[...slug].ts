import { OGImageRoute } from "astro-og-canvas";
import { getCollection } from "astro:content";

type OGPage = {
  title: string;
  description: string;
  identity: "profile" | "jester";
};

const posts = (await getCollection("posts")).filter((post) => !post.data.draft);
const projects = await getCollection("projects");

const pages: Record<string, OGPage> = {
  home: {
    title: "Mitchell Hynes",
    description: "Full-Stack Developer · Computing law at Spellbook.",
    identity: "profile",
  },
  about: {
    title: "I build things that last.",
    description: "Developer, maker, and lifelong learner in St. John’s.",
    identity: "profile",
  },
  blog: {
    title: "Notes from the edges.",
    description: "Essays, build logs, lessons, and experiments.",
    identity: "jester",
  },
  projects: {
    title: "Things I’ve built.",
    description: "Selected software projects, experiments, and games.",
    identity: "profile",
  },
  ...Object.fromEntries(
    posts.map(({ id, data }) => [
      `blog/${id}`,
      {
        title: data.title,
        description: `${data.kind === "devlog" ? "Dev log" : "Blog"} · ${data.description}`,
        identity: "jester" as const,
      },
    ]),
  ),
  ...Object.fromEntries(
    projects.map(({ id, data }) => [
      `projects/${id}`,
      {
        title: data.title,
        description: `Project · ${data.description}`,
        identity: "profile" as const,
      },
    ]),
  ),
};

export const { getStaticPaths, GET } = await OGImageRoute({
  pages,
  getImageOptions: (_path, page) => ({
    title: page.title,
    description: page.description,
    logo: {
      path: page.identity === "jester" ? "./public/favicon.png" : "./public/profile.jpeg",
      size: [96],
    },
    bgGradient: [
      [253, 251, 249],
      [248, 242, 239],
    ],
    border: {
      color: [161, 22, 61],
      width: 18,
      side: "inline-start",
    },
    padding: 64,
    font: {
      title: {
        families: ["EB Garamond", "Georgia", "serif"],
        weight: "Normal",
        color: [38, 33, 31],
        size: 72,
        lineHeight: 1.02,
      },
      description: {
        families: ["Atkinson Hyperlegible", "Arial", "sans-serif"],
        weight: "Normal",
        color: [104, 91, 86],
        size: 34,
        lineHeight: 1.25,
      },
    },
    fonts: [
      "https://cdn.jsdelivr.net/fontsource/fonts/eb-garamond@latest/latin-400-normal.ttf",
      "https://cdn.jsdelivr.net/fontsource/fonts/atkinson-hyperlegible@latest/latin-400-normal.ttf",
    ],
  }),
});
