import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://mitchellhynes.com",
  integrations: [mdx(), sitemap(), react()],
  markdown: {
    shikiConfig: {
      theme: "github-light",
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
