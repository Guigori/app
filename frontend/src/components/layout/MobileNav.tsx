import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { BOTTOM_LEFT, BOTTOM_RIGHT, type NavItem } from "@/components/layout/nav";
import { useQuickActions } from "@/components/layout/QuickActions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

function MobileTab({ item }: { item: NavItem }) {
  return (
    <NavLink to={item.to} end={item.to === "/"} className={({ isActive }) => cn(
      "flex h-14 min-w-14 items-center justify-center rounded-full transition-all duration-200",
      isActive ? "bg-primary text-primary-foreground shadow-[0_5px_18px_hsl(var(--primary)/.30)]" : "text-muted-foreground"
    )} data-testid={`mobile-nav-${item.slug}`}>
      {({ isActive }) => (
        <motion.span animate={{ scale: isActive ? 1.08 : 1 }} transition={{ type: "spring", stiffness: 420, damping: 28 }}>
          <item.icon className="h-6 w-6" aria-hidden="true" />
          <span className="sr-only">{item.label}</span>
        </motion.span>
      )}
    </NavLink>
  );
}

export function MobileNav() {
  const { actions, run } = useQuickActions();
  const [visible, setVisible] = useState(true);
  const timer = useRef<number | null>(null);

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
    };
  }, []);

  return (
    <motion.nav
      initial={false}
      animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : 18, scale: visible ? 1 : 0.97 }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn("fixed inset-x-0 bottom-[max(0.7rem,env(safe-area-inset-bottom))] z-40 flex justify-center px-3 dashboard:hidden", !visible && "pointer-events-none")}
      data-testid="mobile-nav"
    >
      <div className="flex w-full max-w-[28rem] items-center gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-4 items-center rounded-[2.15rem] border border-white/15 bg-background/55 p-1.5 shadow-[0_10px_35px_rgba(0,0,0,.24),inset_0_1px_0_rgba(255,255,255,.14)] backdrop-blur-[28px] supports-[backdrop-filter]:bg-background/45">
          {BOTTOM_LEFT.map((item) => <MobileTab key={item.to} item={item} />)}
          {BOTTOM_RIGHT.map((item) => <MobileTab key={item.to} item={item} />)}
        </div>

        <DropdownMenu open={quickOpen} onOpenChange={setQuickOpen}>
          <DropdownMenuTrigger className="flex h-[4.15rem] w-[4.15rem] shrink-0 items-center justify-center rounded-full border border-white/15 bg-background/55 text-foreground shadow-[0_10px_35px_rgba(0,0,0,.24),inset_0_1px_0_rgba(255,255,255,.16)] backdrop-blur-[28px] transition-transform active:scale-90 supports-[backdrop-filter]:bg-background/45" aria-label="Adicionar lançamento" data-testid="mobile-quick-action-button">
            <Plus className="h-8 w-8" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" sideOffset={12} className="mb-2 w-60 rounded-[1.7rem] border border-white/15 bg-background/65 p-2 shadow-[0_18px_55px_rgba(0,0,0,.35),inset_0_1px_0_rgba(255,255,255,.16)] backdrop-blur-[30px] supports-[backdrop-filter]:bg-background/55 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95" data-testid="mobile-quick-action-menu">
            {actions.map((action) => (
              <DropdownMenuItem key={action.testid} onClick={() => run(action)} className="gap-3 rounded-xl px-3 py-2.5 text-sm font-medium" data-testid={`mobile-${action.testid}`}>
                <action.icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />{action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.nav>
  );
}
