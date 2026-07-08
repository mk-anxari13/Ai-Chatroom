import React from "react";

type TooltipProps = {
  content: React.ReactNode;
  children: React.ReactNode;
};

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <div className="relative inline-block group">
      {children}
      <div className="pointer-events-none absolute left-1/2 bottom-full mb-2 z-50 hidden max-w-xs -translate-x-1/2 rounded-md bg-zinc-900 px-2 py-1 text-xs text-white group-hover:block">
        {content}
      </div>
    </div>
  );
}

export default Tooltip;
