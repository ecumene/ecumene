import toml from "toml";
import fs from "fs";
import path from "path";

export interface Portfolio {
  id: string;
  title: string;
  description: string;
  image: string;
  link: string;
  github: string;
  tags: string[];
}

const portfolioPath = path.join(process.cwd(), "portfolio");
const portfolioFiles = fs.readdirSync(portfolioPath);

export default portfolioFiles
  .map((fileName) => {
    const fullPath = path.join(portfolioPath, fileName);
    if (!fileName.endsWith(".toml")) return;
    const fileContents = fs.readFileSync(fullPath, "utf8");
    const data = toml.parse(fileContents) as Omit<Portfolio, "id">;
    return {
      id: fileName.replace(/\.toml$/, ""),
      ...data,
    };
  })
  .filter(
    (item: Portfolio | undefined): item is Portfolio => item !== undefined
  );

export const getPortfolioData = (fileName: string): Portfolio => {
  const fullPath = path.join(portfolioPath, fileName);
  const fileContents = fs.readFileSync(fullPath, "utf8");
  const data = toml.parse(fileContents);
  return data;
};

export const getAllPortfolioIds = () => {
  return portfolioFiles.map((fileName) => {
    return {
      params: {
        id: fileName.replace(/\.toml$/, ""),
      },
    };
  });
};
