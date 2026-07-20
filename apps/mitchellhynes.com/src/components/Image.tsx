import { useId } from "react";

import ImagePreview from "./ImagePreview";

interface ImageProps {
  src: string;
  alt: string;
  caption?: string;
  description?: string;
  className?: string;
}

export default function Image({ src, alt, caption, description, className }: ImageProps) {
  const previewId = `image-preview-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <>
      <figure className="mdx-image not-prose">
        <a
          href={`#${previewId}`}
          data-image-preview-trigger={previewId}
          className="group block w-full cursor-zoom-in overflow-hidden rounded-lg border-0 bg-transparent p-0 text-left transition-transform hover:scale-[1.01] focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-800 focus-visible:ring-offset-2"
          aria-label={`View ${alt}`}
          aria-haspopup="dialog"
        >
          <img
            src={src}
            alt={alt}
            className={`block w-full rounded-lg ${className ?? ""}`}
            loading="lazy"
          />
        </a>
        {caption && (
          <figcaption className="mt-2 text-center font-serif text-sm leading-snug text-stone-500">
            {caption}
          </figcaption>
        )}
      </figure>

      <ImagePreview id={previewId} src={src} alt={alt} {...(description ? { description } : {})} />
    </>
  );
}
