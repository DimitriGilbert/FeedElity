import { cva } from "class-variance-authority";
import * as React from "react";

import { cn } from "~/lib/utils";

import type { VariantProps } from "class-variance-authority";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-950 focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-neutral-50 text-neutral-900 shadow hover:bg-neutral-200",
        secondary:
          "border-transparent bg-neutral-800 text-neutral-50 hover:bg-neutral-700",
        destructive:
          "border-transparent bg-red-900 text-neutral-50 shadow hover:bg-red-900/80",
        outline: "border-neutral-800 text-neutral-50",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
