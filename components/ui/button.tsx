import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Base: Fluent interactive element — smooth transitions, focus ring
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "text-sm font-medium select-none",
    "transition-all duration-[100ms] ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0078D4] focus-visible:ring-offset-1",
    "disabled:pointer-events-none disabled:opacity-40",
    "cursor-pointer",
  ].join(" "),
  {
    variants: {
      variant: {
        // Fluent Accent Fill Button — primary CTA
        default:
          "bg-[#0078D4] text-white rounded-md hover:bg-[#106EBE] active:bg-[#005A9E] shadow-[0_1px_2px_rgba(0,0,0,0.12)]",
        // Fluent Standard Button — secondary actions
        outline:
          "bg-white text-[#1A1A1A] border border-[#C7C7C7] rounded-md hover:bg-[#EBEBEB] active:bg-[#E5E5E5]",
        // Fluent Subtle Button — low-emphasis, icon-adjacent
        ghost:
          "bg-transparent text-[#1A1A1A] rounded-md hover:bg-[#E5E5E5] active:bg-[#DCDCDC]",
        // Fluent Secondary Button — muted actions
        secondary:
          "bg-[#EBEBEB] text-[#1A1A1A] rounded-md hover:bg-[#E5E5E5] active:bg-[#DCDCDC]",
        // Fluent Danger Button
        destructive:
          "bg-[#C42B1C] text-white rounded-md hover:bg-[#A52110] active:bg-[#8A1B0D]",
      },
      size: {
        default: "h-9 px-4 py-2 text-sm",
        sm:      "h-7 px-3 text-xs rounded-md",
        lg:      "h-10 px-6 text-sm",
        icon:    "h-9 w-9 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
