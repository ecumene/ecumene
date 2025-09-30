import type { Project } from "../content/config";
import { motion } from "framer-motion";
import { useRef, useEffect, useState } from "react";

export default function ProjectCard({
  slug,
  project,
}: {
  slug: string;
  project: Project;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640); // sm breakpoint
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (isMobile && videoRef.current) {
      videoRef.current.play();
    }
  }, [isMobile]);

  const handleMouseEnter = () => {
    if (videoRef.current && !isMobile) {
      videoRef.current.play();
    }
  };

  const handleMouseLeave = () => {
    if (videoRef.current && !isMobile) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  return (
    <motion.a
      href={`/projects/${slug}`}
      className="group cursor-pointer flex sm:flex-row flex-col sm:gap-4 p-6 rounded-lg border border-gray-200 hover:border-rose-800 overflow-hidden"
      whileHover={{
        scale: 1.03,
        boxShadow: "0 10px 25px rgba(0, 0, 0, 0.15)",
      }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 30,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="flex-shrink-0 sm:w-48 sm:h-32 w-full h-48 overflow-hidden rounded-lg bg-gray-100 group-hover:-rotate-[5deg] group-hover:scale-150 transition-transform duration-300 ease-in-out">
        <video
          ref={videoRef}
          src={project.video}
          loop
          muted
          playsInline
          className="w-full h-full object-cover"
        />
      </div>
      <div className="flex flex-col gap-2 flex-1 group-hover:translate-x-16 transition-transform duration-300 ease-in-out">
        <div className="text-sm text-gray-500">
          {project.pubDate.toLocaleDateString()}
        </div>
        <div className="text-xl font-bold group-hover:text-rose-800">
          {project.title}
        </div>
        <div className="text-gray-700">{project.description}</div>
        <div className="flex flex-wrap gap-2 ">
          {project.technologies.split(",").map((tech) => (
            <span
              key={tech}
              className="px-2 py-1 bg-rose-100 rounded text-sm group-hover:bg-rose-800 group-hover:text-white font-bold"
            >
              {tech.trim()}
            </span>
          ))}
        </div>
      </div>
    </motion.a>
  );
}
