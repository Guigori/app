import { NavLink } from "react-router-dom";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { navItemsFor, useNavigationPreferences } from "@/lib/navigationPreferences";

/** Horizontal, scrollable tab strip under the header — the active tab keeps an animated
 *  underline that slides between items instead of snapping. */
export function TopTabs() {
  const preferences = useNavigationPreferences();
  const visibleTabs = navItemsFor(preferences.web).filter((tab) => !tab.soon && tab.slug !== "ia");
  return (
    <div
      className="sticky top-14 z-10 hidden px-3 pt-2 dashboard:block"
      data-testid="top-tabs"
    >
      <div className="mx-auto flex w-full max-w-7xl gap-1 overflow-x-auto rounded-[1.65rem] border border-white/20 bg-background/55 px-2 shadow-[0_10px_32px_rgba(0,0,0,.10),inset_0_1px_0_rgba(255,255,255,.22)] backdrop-blur-[26px] supports-[backdrop-filter]:bg-background/45 sm:px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visibleTabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === "/"}
            className={({ isActive }) =>
              cn(
                "relative flex shrink-0 items-center gap-2 rounded-full px-3 py-3 text-sm font-medium transition-all duration-200",
                isActive ? "bg-primary/[.07] text-primary" : "text-muted-foreground hover:bg-background/35 hover:text-foreground",
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
