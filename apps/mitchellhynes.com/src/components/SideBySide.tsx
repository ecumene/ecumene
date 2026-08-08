import type { ReactNode } from "react";

interface SideBySideProps {
  children: ReactNode;
  reverse?: boolean;
  gap?: "sm" | "md" | "lg";
}

interface ItemProps {
  children: ReactNode;
  className?: string;
}

function SideBySide({ children, reverse = false, gap = "md" }: SideBySideProps) {
  const gapClass = { sm: "gap-3", md: "gap-7", lg: "gap-10" }[gap];
  const direction = reverse ? "md:flex-row-reverse" : "md:flex-row";

  return (
    <div
      className={`markdown-side-by-side my-9 flex flex-col ${direction} ${gapClass} items-start`}
    >
      {children}
    </div>
  );
}

function Media({ children, className }: ItemProps) {
  return (
    <div className={`markdown-side-by-side__media w-full shrink-0 md:w-[42%] ${className ?? ""}`}>
      {children}
    </div>
  );
}

function Content({ children, className }: ItemProps) {
  return (
    <div className={`markdown-side-by-side__content min-w-0 flex-1 ${className ?? ""}`}>
      {children}
    </div>
  );
}

SideBySide.Media = Media;
SideBySide.Content = Content;

export default SideBySide;
