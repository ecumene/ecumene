import { useId } from "react";

import ImagePreview from "./ImagePreview";

export interface GalleryImage {
  src: string;
  alt: string;
  caption?: string;
  description?: string;
}

interface ImageGalleryProps {
  images: GalleryImage[];
  columns?: 2 | 3 | 4;
}

export default function ImageGallery({ images, columns = 3 }: ImageGalleryProps) {
  const galleryId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const previewIds = images.map((_, index) => `image-gallery-${galleryId}-${index}`);
  const gridCols = {
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 md:grid-cols-3",
    4: "grid-cols-2 md:grid-cols-4",
  }[columns];

  return (
    <>
      <div className={`not-prose my-10 grid ${gridCols} gap-3`}>
        {images.map((image, imageIndex) => (
          <figure key={image.src} className="m-0 min-w-0">
            <a
              href={`#${previewIds[imageIndex]!}`}
              data-image-preview-trigger={previewIds[imageIndex]!}
              className="group block w-full cursor-zoom-in overflow-hidden rounded-lg border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-800 focus-visible:ring-offset-2"
              aria-label={`View ${image.alt}`}
              aria-haspopup="dialog"
            >
              <img
                src={image.src}
                alt={image.alt}
                className="aspect-[4/3] w-full rounded-lg object-cover transition-transform duration-200 group-hover:scale-[1.025]"
                loading="lazy"
              />
            </a>
            {image.caption && (
              <figcaption className="mt-2 text-center font-sans text-sm leading-snug text-stone-500">
                {image.caption}
              </figcaption>
            )}
          </figure>
        ))}
      </div>

      {images.map((image, imageIndex) => {
        const previewId = previewIds[imageIndex]!;
        const navigationTargets =
          images.length > 1
            ? {
                previousTarget: previewIds[(imageIndex - 1 + images.length) % images.length]!,
                nextTarget: previewIds[(imageIndex + 1) % images.length]!,
              }
            : {};

        return (
          <ImagePreview
            key={previewId}
            id={previewId}
            src={image.src}
            alt={image.alt}
            {...(image.description ? { description: image.description } : {})}
            {...navigationTargets}
          />
        );
      })}
    </>
  );
}
