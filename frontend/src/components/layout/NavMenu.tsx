import { NavLink } from "react-router-dom";
import { motion } from "motion/react";
import { ChevronRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_GROUPS } from "@/components/layout/nav";

interface NavMenuProps {
  /** Called after a link is followed — the drawer uses it to close itself. */
  onNavigate?: () => void;
  /** Staggered entrance; on the always-visible sidebar it runs once on mount. */
  animate?: boolean;
  /** Prefixes the data-testid so the sidebar and the drawer never collide. */
  testidPrefix?: string;
}

/** The Calen-style grouped navigation, shared by the desktop sidebar and the drawer:
 *  soft icon tiles, section captions and a left bar marking the active route. */
export function NavMenu({ onNavigate, animate = true, testidPrefix = "nav" }: NavMenuProps) {
  let index = -1;
  return (
    <nav className="flex flex-col gap-5 max-dashboard:gap-3" data-testid={`${testidPrefix}-menu`}>
      {NAV_GROUPS.map((group) => (
        <div key={group.label ?? "principal"}>
          {group.label ? (
            <p className="mb-1.5 flex items-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: group.dot }} aria-hidden="true" />
              {group.label}
            </p>
          ) : null}
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              index += 1;
              const delay = animate ? Math.min(index, 12) * 0.025 : 0;
              return (
                <motion.div
                  key={item.to}
                  initial={animate ? { opacity: 0, x: -10 } : false}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <NavLink
                    to={item.to}
                    end={item.to === "/"}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all duration-200 max-dashboard:rounded-[1.4rem] max-dashboard:border max-dashboard:border-white/5 max-dashboard:bg-muted/35 max-dashboard:shadow-sm max-dashboard:backdrop-blur-xl",
                        isActive ? "bg-primary/8 text-foreground max-dashboard:bg-foreground/[0.09] max-dashboard:border-foreground/10" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                      )
                    }
                    data-testid={`${testidPrefix}-${item.slug}`}
                  >
                    {({ isActive }) => (
                      <>
                        {isActive ? (
                          <motion.span
                            layoutId="nav-active-bar"
                            className="absolute inset-y-2 left-0 w-1 rounded-full bg-primary"
                            transition={{ type: "spring", stiffness: 420, damping: 32 }}
                            aria-hidden="true"
                          />
                        ) : null}
                        <span
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-200 max-dashboard:bg-transparent",
                            isActive
                              ? "bg-primary text-primary-foreground"
                              : "bg-primary/10 text-primary group-hover:bg-primary/15",
                          )}
                          aria-hidden="true"
                        >
                          <item.icon className="h-4.5 w-4.5" />
                        </span>
                        <span className={cn("flex-1 truncate", isActive && "font-semibold text-primary")}>{item.label}</span>
                        {item.soon ? (
                          <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            <Lock className="h-3 w-3" aria-hidden="true" />
                            Em breve
                          </span>
                        ) : (
                          <ChevronRight
                            className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform duration-200 group-hover:translate-x-0.5"
                            aria-hidden="true"
                          />
                        )}
                      </>
                    )}
                  </NavLink>
                </motion.div>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
