import { NavLink } from "react-router-dom";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { TOP_TABS } from "@/components/layout/nav";

/** Horizontal, scrollable tab strip under the header — the active tab keeps an animated
 *  underline that slides between items instead of snapping. */
export function TopTabs() {
  return (
    <div
      className="sticky top-14 z-10 border-b border-border bg-background/85 backdrop-blur"
      data-testid="top-tabs"
    >
      <div className="mx-auto flex w-full max-w-7xl gap-1 overflow-x-auto px-2 sm:px-4 lg:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TOP_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === "/"}
            className={({ isActive }) =>
              cn(
                "relative flex shrink-0 items-center gap-2 px-3 py-3 text-sm font-medium transition-colors duration-200",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )
            }
            data-testid={`top-tab-${tab.slug}`}
          >
            {({ isActive }) => (
              <>
                <tab.icon className={cn("h-4.5 w-4.5 transition-transform duration-200", isActive && "scale-110")} aria-hidden="true" />
                {tab.label}
                {isActive ? (
                  <motion.span
                    layoutId="top-tab-underline"
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    aria-hidden="true"
                  />
                ) : null}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
