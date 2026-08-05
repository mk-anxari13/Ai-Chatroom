import React, { useState } from "react";
import { cn } from "@/lib/utils";

type TooltipProps = {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
};

export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const [visible, setVisible] = useState(false);

  const positionClasses = {
    top:    "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left:   "right-full top-1/2 -translate-y-1/2 mr-2",
    right:  "left-full top-1/2 -translate-y-1/2 ml-2",
  }[side];

  return (
    <div
      className={cn("relative inline-flex items-center", className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && content && (
        <div
          role="tooltip"
          className={cn(
            // Windows 11 tooltip: near-black bg, 11px, rounded-md
            "pointer-events-none absolute z-50 max-w-[200px]",
            "bg-[#1F1F1F] text-white text-[11px] leading-tight font-medium",
            "px-2.5 py-1.5 rounded-md whitespace-nowrap",
            "shadow-[0_4px_12px_rgba(0,0,0,0.25)]",
            "animate-fluent-fade",
            positionClasses
          )}
        >
          {content}
        </div>
      )}
    </div>
  );
}

export default Tooltip;
