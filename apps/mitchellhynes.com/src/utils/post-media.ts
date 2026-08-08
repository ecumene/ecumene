import type { CollectionEntry } from "astro:content";

export const getPostThumbnail = (post: CollectionEntry<"posts">) =>
  post.data.previewImage ??
  post.data.heroImage ??
  (post.data.heroVideo ? `/blog-thumbnails/${post.id}.jpg` : undefined);
