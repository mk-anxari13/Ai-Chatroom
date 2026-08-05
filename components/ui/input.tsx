import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Fluent TextBox
          "flex h-9 w-full",
          "bg-white text-[#1A1A1A] placeholder:text-[#8A8A8A]",
          "border border-[#C7C7C7] rounded-md",
          "px-3 py-1.5 text-sm",
          "transition-colors duration-100",
          // Focus: accent blue border + subtle ring
          "focus:outline-none focus:border-[#0078D4] focus:ring-2 focus:ring-[#0078D4]/20",
          // Hover
          "hover:border-[#8A8A8A]",
          // Disabled
          "disabled:bg-[#F3F3F3] disabled:text-[#ABABAB] disabled:cursor-not-allowed",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
