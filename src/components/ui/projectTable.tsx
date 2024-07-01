type Project = {
  date: string;
  projectName: string;
  description: string;
  link: string;
  technologies: string;
};

export default function ProjectTable({ projects }: { projects: Project[] }) {
  return (
    <div>
      <table className="table-auto w-full text-black border-collapse">
        <thead>
          <tr className="bg-gray-200">
            <th className="text-left border border-gray-400 p-2">Date</th>
            <th className="text-left border border-gray-400 p-2">
              Project Name
            </th>
            <th className="text-left border border-gray-400 p-2">
              Description
            </th>
            <th className="text-left border border-gray-400 p-2">
              Technologies
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project, index) => (
            <tr key={index} className="border border-gray-400">
              <td className="p-2 border border-gray-400">{project.date}</td>
              <td className="p-2 border border-gray-400">
                <a href={project.link} className="text-blue-600 underline">
                  {project.projectName}
                </a>
              </td>
              <td className="p-2 border border-gray-400">
                {project.description}
              </td>
              <td className="p-2 border border-gray-400">
                {project.technologies.split(", ").map((tech, index) => (
                  <span
                    key={index}
                    className="inline-block px-2 py-1 mr-2 mb-2 rounded-sm text-xs text-black bg-gray-200"
                  >
                    {tech}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
