import { useState, useRef, useEffect } from "react";

interface TabSwitcherProps {
  tabs: { id: string; label: string }[];
  defaultTab?: string;
  onTabChange?: (tabId: string) => void;
}

export default function TabSwitcher({
  tabs,
  defaultTab,
  onTabChange,
}: TabSwitcherProps) {
  const [activeTab, setActiveTab] = useState<string>(
    defaultTab || tabs[0]?.id || "",
  );
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const activeButton = tabRefs.current.get(activeTab);
    if (activeButton && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const buttonRect = activeButton.getBoundingClientRect();
      setIndicatorStyle({
        left: buttonRect.left - containerRect.left,
        width: buttonRect.width,
      });
    }
  }, [activeTab]);

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
    onTabChange?.(tabId);

    // Toggle panels via DOM
    const postsPanel = document.getElementById("posts-panel");
    const devlogsPanel = document.getElementById("devlogs-panel");

    if (tabId === "posts") {
      postsPanel?.classList.remove("hidden");
      devlogsPanel?.classList.add("hidden");
    } else {
      postsPanel?.classList.add("hidden");
      devlogsPanel?.classList.remove("hidden");
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative inline-flex items-center rounded-full p-1"
    >
      {/* Sliding background indicator with double border */}
      <div
        className="absolute top-1 bottom-1 rounded-full p-[1px] shadow-md transition-all duration-300 ease-out border border-emerald-700/60"
        style={{
          left: indicatorStyle.left,
          width: indicatorStyle.width,
          background: "linear-gradient(to bottom, #5a7a6a, #3a5a4a)",
        }}
      >
        {/* Inner fill */}
        <div
          className="w-full h-full rounded-full"
          style={{
            background: "linear-gradient(to bottom, #4a6b5a, #3a5a4a)",
          }}
        />
      </div>

      {/* Tab buttons */}
      {tabs.map((tab) => (
        <button
          key={tab.id}
          ref={(el) => {
            if (el) tabRefs.current.set(tab.id, el);
          }}
          type="button"
          onClick={() => handleTabClick(tab.id)}
          className={`relative z-10 px-6 py-2 rounded-full font-serif text-base transition-all duration-300 active:scale-95
            ${activeTab === tab.id ? "text-cream-50" : "text-emerald-600 hover:text-emerald-600/70"}
          `}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
