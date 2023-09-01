import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://mitchellhynes.com/"),
  title: "Mitchell Hynes",
  description: "Full-Stack Developer",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="">{children}</div>;
}
