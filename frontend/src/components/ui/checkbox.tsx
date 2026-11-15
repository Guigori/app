"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "@/lib/utils"

/** The app's on/off control. Same API as a checkbox, drawn as a switch everywhere. */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group peer relative inline-flex h-[26px] w-11 shrink-0 items-center rounded-full bg-muted-foreground/30 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className="absolute left-[3px] size-5 rounded-full bg-white shadow transition-transform group-data-checked:translate-x-[18px]" />
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
