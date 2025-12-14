import { useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";

export interface GalleryImage {
  src: string;
  alt: string;
  caption?: string;
}

interface ImageGalleryProps {
  images: GalleryImage[];
  columns?: 2 | 3 | 4;
}

export default function ImageGallery({
  images,
  columns = 3,
}: ImageGalleryProps) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const handleImageClick = (i: number) => {
    setIndex(i);
    setOpen(true);
  };

  const gridCols = {
    2: "grid-cols-2",
    3: "grid-cols-2 md:grid-cols-3",
    4: "grid-cols-2 md:grid-cols-4",
  };

  return (
    <>
      <div className={`grid ${gridCols[columns]} gap-2`}>
        {images.map((image, i) => (
          <button
            key={i}
            onClick={() => handleImageClick(i)}
            className="group overflow-hidden rounded-lg cursor-pointer border-0 p-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-emerald-600 transition-transform hover:scale-[1.02]"
            aria-label={`View ${image.alt}`}
          >
            <img
              src={image.src}
              alt={image.alt}
              className="w-full h-18 object-cover rounded-lg"
              loading="lazy"
            />
            {image.caption && (
              <p className="text-sm text-gray-600 text-center mt-1">
                {image.caption}
              </p>
            )}
          </button>
        ))}
      </div>

      <Lightbox
        open={open}
        close={() => setOpen(false)}
        index={index}
        slides={images.map((img) => ({
          src: img.src,
          alt: img.alt,
          title: img.caption,
        }))}
        controller={{ closeOnBackdropClick: true }}
        carousel={{ finite: images.length <= 1 }}
        styles={{
          container: { backgroundColor: "rgba(0, 0, 0, 0.9)" },
        }}
        render={{
          slideFooter: ({ slide }) =>
            slide.alt ? (
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: "16px",
                  background: "rgba(0, 0, 0, 0.6)",
                  color: "white",
                  textAlign: "center",
                  wordWrap: "break-word",
                  overflowWrap: "break-word",
                  whiteSpace: "normal",
                }}
              >
                {slide.alt}
              </div>
            ) : null,
        }}
      />
    </>
  );
}
