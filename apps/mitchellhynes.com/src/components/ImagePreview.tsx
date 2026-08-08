import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface ImagePreviewProps {
  id: string;
  src: string;
  alt: string;
  description?: string;
  previousTarget?: string;
  nextTarget?: string;
}

export default function ImagePreview({
  id,
  src,
  alt,
  description,
  previousTarget,
  nextTarget,
}: ImagePreviewProps) {
  return (
    <div
      id={id}
      className="image-preview"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${alt}`}
    >
      <a
        href="#image-preview-closed"
        className="image-preview__close"
        aria-label="Close image preview"
      >
        <X aria-hidden="true" size={24} strokeWidth={1.75} />
      </a>

      <a
        href="#image-preview-closed"
        className="image-preview__backdrop"
        tabIndex={-1}
        aria-label="Close image preview"
      />

      <figure className="image-preview__figure">
        <img className="image-preview__image" src={src} alt={alt} />
        {description && <figcaption className="image-preview__caption">{description}</figcaption>}
      </figure>

      {previousTarget && (
        <a
          href={`#${previousTarget}`}
          className="image-preview__navigation image-preview__navigation--previous"
          aria-label="View previous image"
        >
          <ChevronLeft aria-hidden="true" size={30} strokeWidth={1.65} />
        </a>
      )}

      {nextTarget && (
        <a
          href={`#${nextTarget}`}
          className="image-preview__navigation image-preview__navigation--next"
          aria-label="View next image"
        >
          <ChevronRight aria-hidden="true" size={30} strokeWidth={1.65} />
        </a>
      )}
    </div>
  );
}
