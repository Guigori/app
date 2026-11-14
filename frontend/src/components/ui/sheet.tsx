"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { gestureBlockedBy } from "@/lib/gestures/gestureTarget"

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
      {...props}
    />
  )
}

type Side = "top" | "right" | "bottom" | "left"

/**
 * Swiping a sheet back toward the edge it came from closes it, like the native ones: the menu to the
 * left, a bottom sheet down (once its content is scrolled to the top). It follows the finger; short of
 * the mark it slides back.
 */
function useSwipeToDismiss(side: Side) {
  const [node, setNode] = React.useState<HTMLElement | null>(null)
  const closer = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (!node) return
    const axis = side === "left" || side === "right" ? "x" : "y"
    const sign = side === "left" || side === "top" ? -1 : 1
    let g: { x: number; y: number; t: number; target: EventTarget | null; mode: "go" | "no" | null; d: number } | null = null
    const paint = (d: number, animate: boolean) => {
      node.style.transition = animate ? "transform 200ms cubic-bezier(.2,.8,.2,1)" : "none"
      node.style.transform = d ? (axis === "x" ? `translate3d(${d}px,0,0)` : `translate3d(0,${d}px,0)`) : ""
    }
    const start = (e: TouchEvent) => {
      g = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now(), target: e.target, mode: null, d: 0 } : null
    }
    const move = (e: TouchEvent) => {
      if (!g || e.touches.length !== 1) return
      const dx = e.touches[0].clientX - g.x
      const dy = e.touches[0].clientY - g.y
      const along = axis === "x" ? dx : dy
      const across = axis === "x" ? dy : dx
      if (!g.mode) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return
        g.mode = Math.abs(along) > Math.abs(across) * 1.2 && along * sign > 0 && !gestureBlockedBy(g.target, axis, along) ? "go" : "no"
      }
      if (g.mode !== "go") return
      if (e.cancelable) e.preventDefault()
      g.d = sign > 0 ? Math.max(0, along) : Math.min(0, along)
      paint(g.d, false)
    }
    const end = () => {
      const s = g
      g = null
      if (!s || s.mode !== "go") return
      const speed = Math.abs(s.d) / Math.max(1, performance.now() - s.t)
      if (Math.abs(s.d) > 80 || (speed > 0.5 && Math.abs(s.d) > 30)) closer.current?.click()
      else paint(0, true)
    }
    node.addEventListener("touchstart", start, { passive: true })
    node.addEventListener("touchmove", move, { passive: false })
    node.addEventListener("touchend", end, { passive: true })
    node.addEventListener("touchcancel", end, { passive: true })
    return () => {
      node.removeEventListener("touchstart", start)
      node.removeEventListener("touchmove", move)
      node.removeEventListener("touchend", end)
      node.removeEventListener("touchcancel", end)
    }
  }, [node, side])
  return { ref: setNode, closer }
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: Side
  showCloseButton?: boolean
}) {
  const swipe = useSwipeToDismiss(side)
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        ref={swipe.ref}
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "group/sheet fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-ending-style:translate-y-[2.5rem] data-[side=bottom]:data-starting-style:translate-y-[2.5rem] data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:data-ending-style:translate-x-[-2.5rem] data-[side=left]:data-starting-style:translate-x-[-2.5rem] data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-[2.5rem] data-[side=right]:data-starting-style:translate-x-[2.5rem] data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-ending-style:translate-y-[-2.5rem] data-[side=top]:data-starting-style:translate-y-[-2.5rem] data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
          className
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close ref={swipe.closer} tabIndex={-1} aria-hidden="true" className="sr-only" data-slot="sheet-swipe-close" />
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              // Padrão FINNOS: fechar sempre à esquerda, o título ao lado.
              <Button
                variant="ghost"
                className="absolute top-3 left-3 z-10 size-10 rounded-full border border-border bg-card hover:bg-muted"
                size="icon"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Fechar</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4 group-has-[[data-slot=sheet-close]]/sheet:min-h-16 group-has-[[data-slot=sheet-close]]/sheet:justify-center group-has-[[data-slot=sheet-close]]/sheet:pl-16", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
