import type { Project } from "../types";

export default function ProjectCard({ project }: { project: Project }) {
  return (
    <div className="group cursor-pointer flex flex-col gap-2 p-6 rounded-lg border border-gray-200 hover:border-rose-800">
      <div className="text-sm text-gray-500">{project.date}</div>
      <div className="text-xl font-bold group-hover:text-rose-800">
        <a href={project.link} target="_blank" rel="noopener noreferrer">
          {project.projectName}
        </a>
      </div>
      <div className="text-gray-700">{project.description}</div>
      <div className="flex flex-wrap gap-2 ">
        {project.technologies.split(",").map((tech) => (
          <span
            key={tech}
            className="px-2 py-1 bg-gray-100 rounded text-sm group-hover:bg-rose-800 group-hover:text-white font-bold"
          >
            {tech.trim()}
          </span>
        ))}
      </div>
    </div>
  );
}
