import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-md border border-hairline-strong bg-surface-card px-4 py-2 text-sm text-ink transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ink focus-visible:border-2 focus-visible:ring-0 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-canvas-soft disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
