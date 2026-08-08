"use client";

import React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

type TooltipProps = {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
};

export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  if (!content) {
    return <>{children}</>;
  }

  return (
    <TooltipPrimitive.Provider>
      <TooltipPrimitive.Root delayDuration={200}>
        <TooltipPrimitive.Trigger asChild>
          <div className={cn("inline-flex items-center", className)}>
            {children}
          </div>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={4}
            className={cn(
              "z-[100] overflow-hidden rounded-md bg-[#1F1F1F] px-2.5 py-1.5 text-[11px] font-medium leading-tight text-white",
              "shadow-[0_4px_12px_rgba(0,0,0,0.25)] animate-fluent-fade",
              "max-w-[200px] whitespace-nowrap"
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export default Tooltip;
