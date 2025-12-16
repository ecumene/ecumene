import { useRef } from "react";

interface DevlogCardProps {
  title: string;
  description: string;
  date: Date;
  slug: string;
  video: string;
  logNumber: number;
}

export default function DevlogCard({
  title,
  description,
  date,
  slug,
  video,
  logNumber,
}: DevlogCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleMouseEnter = () => {
    videoRef.current?.play();
  };

  const handleMouseLeave = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  return (
    <a
      href={`/devlog/${slug}`}
      className="group block grayscale brightness-110 hover:grayscale-0 hover:brightness-100 transition duration-300"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="relative w-full aspect-video overflow-hidden">
        <video
          ref={videoRef}
          src={video}
          className="w-full h-full object-cover"
          muted
          loop
          playsInline
          preload="metadata"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-blue-100 via-blue-100/20 to-transparent pointer-events-none" />

        <div className="absolute bottom-0 left-0 right-0 px-4 pb-4">
          <span className="text-gold-50 text-sm italic">Log #{logNumber}</span>
          <h3 className="text-3xl text-cream-50 leading-tight font-serif">
            {title}
          </h3>
        </div>
      </div>

      <div className="border-l-4 border-emerald-600 pl-4 mt-3">
        <p className="text-blue-100/70 italic">
          {date.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </p>
        <p className="mt-1 text-blue-100">{description}</p>
      </div>
    </a>
  );
}

