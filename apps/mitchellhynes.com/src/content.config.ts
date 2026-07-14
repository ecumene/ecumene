import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { defineCollection } from "astro:content";

const posts = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/posts" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    card: z.string().optional(),
  }),
});

const projectSchema = z.object({
  title: z.string(),
  description: z.string(),
  link: z.string(),
  technologies: z.string(),
  pubDate: z.coerce.date(),
  video: z.string(),
});

const projects = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/projects" }),
  schema: projectSchema,
});

type Project = z.infer<typeof projectSchema>;

export const collections = { posts, projects };

export type { Project };
