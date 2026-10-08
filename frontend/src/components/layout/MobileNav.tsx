import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { type NavItem } from "@/components/layout/nav";
import { navItemsFor, useNavigationPreferences } from "@/lib/navigationPreferences";
import { useQuickActions } from "@/components/layout/QuickActions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

function MobileTab({ item, onNavigate }: { item: NavItem; onNavigate: (to: string) => void }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(item.to);
      }}
      className={({ isActive }) =>
        cn(
          "relative flex h-[3.55rem] min-w-0 items-center justify-center overflow-hidden rounded-full px-2 transition-colors duration-200",
          isActive
            ? "bg-white text-[#070F52] shadow-[0_2px_12px_rgba(3,8,31,.08)] dark:bg-white/95 dark:text-[#070F52]"
            : "text-[#070F52]/65 dark:text-white/70"
        )
      }
      data-testid={`mobile-nav-${item.slug}`}
    >
      {({ isActive }) => (
        <motion.span
          layout
          className="flex min-w-0 items-center justify-center gap-2"
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
        >
          <item.icon className="h-[1.45rem] w-[1.45rem] shrink-0" aria-hidden="true" />
          {isActive ? (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              className="overflow-hidden whitespace-nowrap text-[clamp(.65rem,2.5vw,.88rem)] font-semibold"
            >
              {item.label}
            </motion.span>
          ) : (
            <span className="sr-only">{item.label}</span>
          )}
        </motion.span>
      )}
    </NavLink>
  );
}

export function MobileNav() {
  const { actions, run } = useQuickActions();
  const navigationPreferences = useNavigationPreferences();
  const mobileItems = navItemsFor(navigationPreferences.mobile);
  const navigate = useNavigate();
  const location = useLocation();
  const activeIndex = mobileItems.findIndex((item) => item.to === location.pathname || (item.to === "/" && location.pathname === "/"));
  const [quickOpen, setQuickOpen] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [visible, setVisible] = useState(true);
  const timer = useRef<number | null>(null);
  const transitionTimer = useRef<number | null>(null);

  const navigateFromDock = (to: string) => {
    if (transitioning) return;
    setTransitioning(true);
    if (transitionTimer.current) window.clearTimeout(transitionTimer.current);
    transitionTimer.current = window.setTimeout(() => {
      navigate(to);
      transitionTimer.current = window.setTimeout(() => setTransitioning(false), 240);
    }, 120);
  };

  useEffect(() => {
    const showAfterIdle = () => {
      setVisible(false);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setVisible(true), 220);
    };
    window.addEventListener("scroll", showAfterIdle, { passive: true });
    return () => {
      window.removeEventListener("scroll", showAfterIdle);
      if (timer.current) window.clearTimeout(timer.current);
      if (transitionTimer.current) window.clearTimeout(transitionTimer.current);
    };
  }, []);

  return (
    <>
      <AnimatePresence>
        {transitioning ? (
          <motion.div
            key="dock-page-transition"
            className="pointer-events-none fixed inset-0 z-[38] dashboard:hidden"
            initial={{ opacity: 0, y: 28, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 1.005 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{
              background: "linear-gradient(to top, hsl(var(--primary) / .10), transparent 42%)",
              backdropFilter: "blur(1.5px)",
            }}
            aria-hidden="true"
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {quickOpen ? (
          <motion.div
            key="quick-actions-backdrop"
            className="fixed inset-0 z-[39] bg-black/20 backdrop-blur-[5px] dashboard:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            aria-hidden="true"
          />
        ) : null}
      </AnimatePresence>

      <motion.nav
        initial={false}
        animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : 18, scale: visible ? 1 : 0.97 }}
        transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
        className={cn(
          "fixed inset-x-0 bottom-[max(0.7rem,env(safe-area-inset-bottom))] z-40 flex justify-center px-3 dashboard:hidden",
          !visible && "pointer-events-none"
        )}
        data-testid="mobile-nav"
      >
        <div className="flex w-full max-w-[28rem] items-center gap-2">
          <div style={{ gridTemplateColumns: mobileItems.map((_, index) => `${index === activeIndex ? 2.1 : 1}fr`).join(" ") || "1fr" }}
          className="grid min-w-0 flex-1 items-center rounded-full border border-[#070F52]/10 bg-[#eeeeef]/85 p-1 shadow-[0_8px_28px_rgba(3,8,31,.12),inset_0_1px_0_rgba(255,255,255,.85)] backdrop-blur-[28px] dark:border-white/15 dark:bg-[#161625]/80">
            {mobileItems.map((item) => (
              <MobileTab key={item.to} item={item} onNavigate={navigateFromDock} />
            ))}
          </div>

          <DropdownMenu open={quickOpen} onOpenChange={setQuickOpen}>
            <DropdownMenuTrigger
              className={cn("flex h-[4.05rem] w-[4.05rem] shrink-0 items-center justify-center rounded-full bg-[#4B2CFF] text-white shadow-[0_8px_26px_rgba(75,44,255,.28)] transition-all active:scale-90", quickOpen && "scale-95 bg-[#5B35FF]")}
              aria-label="Adicionar lançamento"
              data-testid="mobile-quick-action-button"
            >
              <Plus className="h-8 w-8" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="end"
              sideOffset={12}
              className="mb-2 w-60 rounded-[1.7rem] border border-white/15 bg-background/65 p-2 shadow-[0_18px_55px_rgba(0,0,0,.35),inset_0_1px_0_rgba(255,255,255,.16)] backdrop-blur-[30px] supports-[backdrop-filter]:bg-background/55 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95"
              data-testid="mobile-quick-action-menu"
            >
              {actions.map((action) => (
                <DropdownMenuItem
                  key={action.testid}
                  onClick={() => run(action)}
                  className="gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"
                  data-testid={`mobile-${action.testid}`}
                >
                  <action.icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </motion.nav>
    </>
  );
}
