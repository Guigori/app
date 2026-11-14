import type { Ref } from "react";
import { ArrowDown, LoaderCircle } from "lucide-react";

/**
 * The circle that comes down with the finger when the screen is pulled at the top. The page gesture
 * (usePageGestures) moves it and turns the arrow; past the mark the arrow points up, and while the data
 * refreshes it spins.
 */
export function PullToRefresh({ ref }: { ref: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} data-testid="pull-to-refresh" data-refreshing="false" data-armed="false"
      className="group pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top)+4.25rem)] z-[45] -ml-5 grid size-10 place-items-center rounded-full border border-border bg-card text-primary opacity-0 shadow-lg lg:hidden dark:text-[#A996FF]"
      style={{ transform: "translateY(-64px)" }}>
      <ArrowDown data-pull-arrow aria-hidden="true" className="size-5 group-data-[refreshing=true]:hidden" />
      <LoaderCircle aria-hidden="true" className="hidden size-5 animate-spin group-data-[refreshing=true]:block" />
      <span data-pull-status role="status" className="sr-only" />
    </div>
  );
}
