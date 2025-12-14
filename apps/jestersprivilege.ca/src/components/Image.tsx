import { useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";

interface ImageProps {
  src: string;
  alt: string;
  caption?: string;
  className?: string;
}

export default function Image({ src, alt, caption, className }: ImageProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <figure className="my-4">
        <button
          onClick={() => setOpen(true)}
          className="block w-full overflow-hidden rounded-lg cursor-pointer border-0 p-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-emerald-600 transition-transform hover:scale-[1.01]"
          aria-label={`View ${alt}`}
        >
          <img
            src={src}
            alt={alt}
            className={`w-full rounded-lg ${className ?? ""}`}
            loading="lazy"
          />
        </button>
        {caption && (
          <figcaption className="text-sm text-gray-600 mt-2 text-center italic">
            {caption}
          </figcaption>
        )}
      </figure>

      <Lightbox
        open={open}
        close={() => setOpen(false)}
        slides={[{ src, alt }]}
        carousel={{ finite: true }}
        render={{
          slideFooter: () =>
            caption ? (
              <div className="text-white text-center py-4 px-6 bg-black/50">
                {caption}
              </div>
            ) : null,
        }}
      />
    </>
  );
}
