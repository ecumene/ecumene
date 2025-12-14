import { useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";

interface ImageProps {
  src: string;
  alt: string;
  caption?: string;
  description?: string;
  className?: string;
}

export default function Image({
  src,
  alt,
  caption,
  description,
  className,
}: ImageProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <figure className="not-prose">
        <button
          onClick={() => setOpen(true)}
          className="group block w-full overflow-hidden rounded-lg cursor-pointer border-0 p-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-emerald-600 transition-transform hover:scale-[1.01]"
          aria-label={`View ${alt}`}
        >
          <img
            src={src}
            alt={alt}
            className={`w-full rounded-lg mt-16 mb-8 ${className ?? ""}`}
            loading="lazy"
          />
          {caption && (
            <p className="text-sm text-gray-600 text-center group-hover:visible invisible">
              {caption}
            </p>
          )}
        </button>
      </figure>

      <Lightbox
        open={open}
        close={() => setOpen(false)}
        slides={[{ src, alt }]}
        carousel={{ finite: true }}
        controller={{ closeOnBackdropClick: true }}
        styles={{
          slide: { flexDirection: "column", alignItems: "center" },
        }}
        render={{
          slideFooter: () =>
            description ? (
              <div className="text-white text-center text-sm md:text-base py-2 px-4 md:py-4 md:px-6 bg-black/80 max-w-full absolute bottom-0 left-0 right-0">
                <div className="max-w-[720px] mx-auto">{description}</div>
              </div>
            ) : null,
        }}
      />
    </>
  );
}
