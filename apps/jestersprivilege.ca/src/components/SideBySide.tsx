import type { ReactNode } from "react";

interface SideBySideProps {
  children: ReactNode;
  reverse?: boolean; // flip order on desktop (image on right)
  gap?: "sm" | "md" | "lg";
}

interface ItemProps {
  children: ReactNode;
  className?: string;
}

function SideBySide({
  children,
  reverse = false,
  gap = "md",
}: SideBySideProps) {
  const gapClass = { sm: "gap-2", md: "gap-6", lg: "gap-10" }[gap];
  const direction = reverse ? "md:flex-row-reverse" : "md:flex-row";

  return (
    <div className={`flex flex-col ${direction} ${gapClass} my-6 items-start`}>
      {children}
    </div>
  );
}

function Media({ children, className }: ItemProps) {
  return (
    <div className={`w-full md:w-1/2 flex-shrink-0 ${className ?? ""}`}>
      {children}
    </div>
  );
}

function Content({ children, className }: ItemProps) {
  return <div className={`flex-1 ${className ?? ""}`}>{children}</div>;
}

SideBySide.Media = Media;
SideBySide.Content = Content;

export default SideBySide;
