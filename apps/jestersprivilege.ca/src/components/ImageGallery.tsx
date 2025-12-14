import { useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";

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
      <div className={`not-prose grid ${gridCols[columns]} gap-2 my-16`}>
        {images.map((image, i) => (
          <button
            key={i}
            onClick={() => handleImageClick(i)}
            className="group overflow-hidden rounded-lg cursor-pointer border-0 p-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-emerald-600 transition-transform hover:scale-[1.02] flex flex-row lg:flex-col"
            aria-label={`View ${image.alt}`}
          >
            <img
              src={image.src}
              alt={image.alt}
              className="w-full h-18 object-cover rounded-lg mb-8"
              loading="lazy"
            />
            {image.caption && (
              <p className="text-sm text-gray-600 text-center group-hover:visible invisible">
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
          description: img.description,
        }))}
        controller={{ closeOnBackdropClick: true }}
        carousel={{ finite: images.length <= 1 }}
        styles={{
          slide: { flexDirection: "column", alignItems: "center" },
        }}
        render={{
          slideFooter: ({ slide }) =>
            (slide as { description?: string }).description ? (
              <div className="text-white text-center text-sm md:text-base py-2 px-4 md:py-4 md:px-6 bg-black/80 max-w-full absolute bottom-0 left-0 right-0">
                <div className="max-w-[720px] mx-auto">
                  {(slide as { description?: string }).description}
                </div>
              </div>
            ) : null,
        }}
      />
    </>
  );
}
