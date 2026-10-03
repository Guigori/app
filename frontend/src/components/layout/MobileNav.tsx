import { NavLink } from "react-router-dom";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { BOTTOM_LEFT, BOTTOM_RIGHT, type NavItem } from "@/components/layout/nav";
import { useQuickActions } from "@/components/layout/QuickActions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function MobileTab({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        cn(
          "relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors duration-200",
          isActive ? "text-primary" : "text-muted-foreground",
        )
      }
      data-testid={`mobile-nav-${item.slug}`}
    >
      {({ isActive }) => (
        <>
          <motion.span
            animate={{ y: isActive ? -1 : 0, scale: isActive ? 1.12 : 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 24 }}
          >
            <item.icon className="h-5 w-5" aria-hidden="true" />
          </motion.span>
          {item.label}
          {isActive ? (
            <motion.span
              layoutId="mobile-nav-dot"
              className="absolute -top-px h-0.5 w-8 rounded-full bg-primary"
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              aria-hidden="true"
            />
          ) : null}
        </>
      )}
    </NavLink>
  );
}

/** Mobile bottom bar with the raised central "+" — the primary action of the whole app. */
export function MobileNav() {
  const { actions, run } = useQuickActions();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dashboard:hidden"
      data-testid="mobile-nav"
    >
      <div className="grid grid-cols-5 items-end">
        {BOTTOM_LEFT.map((item) => (
          <MobileTab key={item.to} item={item} />
        ))}

        <div className="flex justify-center">
          <DropdownMenu>
            <DropdownMenuTrigger
                className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/35 transition-transform duration-200 hover:-translate-y-0.5 active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-label="Adicionar lançamento"
                data-testid="mobile-quick-action-button"
            >
              <Plus className="h-7 w-7" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="center" className="w-60 p-2" data-testid="mobile-quick-action-menu">
              {actions.map((action) => (
                <DropdownMenuItem
                  key={action.testid}
                  onClick={() => run(action)}
                  className={cn(
                    "gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
                    action.testid === "fab-new-transaction" && "bg-primary/5 text-primary",
                  )}
                  data-testid={`mobile-${action.testid}`}
                >
                  <action.icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {BOTTOM_RIGHT.map((item) => (
          <MobileTab key={item.to} item={item} />
        ))}
      </div>
    </nav>
  );
}
