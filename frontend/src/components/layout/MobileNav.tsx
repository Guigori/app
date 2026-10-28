import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Plus } from "lucide-react";
const SmartRegister = lazy(() => import("@/pages/SmartRegister"));
import { cn } from "@/lib/utils";
import { type NavItem } from "@/components/layout/nav";
import { navItemsFor, useNavigationPreferences } from "@/lib/navigationPreferences";



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
          "relative flex h-[3.75rem] min-w-0 items-center justify-center overflow-hidden rounded-full px-1 transition-colors duration-200",
          isActive
            ? "bg-white text-[#080808] shadow-[0_1px_4px_rgba(0,0,0,.035)] dark:bg-white dark:text-black"
            : "text-[#626262] dark:text-white/70"
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
          <item.icon className="h-[1.55rem] w-[1.55rem] shrink-0" aria-hidden="true" />
          {isActive ? (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              className="overflow-hidden whitespace-nowrap text-[clamp(.65rem,2.7vw,.94rem)] font-semibold"
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

  const navigationPreferences = useNavigationPreferences();
  const mobileItems = navItemsFor(navigationPreferences.mobile);
  const navigate = useNavigate();
  const location = useLocation();
  const activeIndex = mobileItems.findIndex((item) => item.to === location.pathname || (item.to === "/" && location.pathname === "/"));

  const [registerOpen, setRegisterOpen] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [visible, setVisible] = useState(true);
  const [compact, setCompact] = useState(false);
  const lastScrollY = useRef(0);
  const scrollDistance = useRef(0);
  const timer = useRef<number | null>(null);
  const transitionTimer = useRef<number | null>(null);

  const navigateFromDock = (to: string) => {
    if (transitioning) return;
    setRegisterOpen(false);
    setTransitioning(true);
    if (transitionTimer.current) window.clearTimeout(transitionTimer.current);
    transitionTimer.current = window.setTimeout(() => {
      navigate(to);
      transitionTimer.current = window.setTimeout(() => setTransitioning(false), 240);
    }, 120);
  };

  useEffect(() => {
    lastScrollY.current = window.scrollY;
    const handleScroll = () => {
      const current = window.scrollY;
      const delta = current - lastScrollY.current;
      lastScrollY.current = current;

      if (current < 24) {
        setVisible(true);
        setCompact(false);
        scrollDistance.current = 0;
      } else if (Math.abs(delta) > 1) {
        scrollDistance.current = Math.max(0, scrollDistance.current + Math.abs(delta));
        setCompact(true);
        if (scrollDistance.current > 110) setVisible(false);
      }
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setVisible(true);
        setCompact(false);
        scrollDistance.current = 0;
      }, 320);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    setVisible(true);
    setCompact(false);
    scrollDistance.current = 0;
  }, [location.pathname]);

  useEffect(() => {
    if (!registerOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setRegisterOpen(false); };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previousOverflow; document.documentElement.style.overflow = previousHtmlOverflow; };
  }, [registerOpen]);

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
        {registerOpen && (
          <>
            <motion.button type="button" aria-label="Fechar registro" onClick={() => setRegisterOpen(false)}
              className="fixed inset-0 z-[39] bg-black/40 backdrop-blur-[12px] dashboard:hidden"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />
            <motion.section role="dialog" aria-modal="true" aria-label="Novo registro"
              className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[40] mx-auto flex max-w-[28rem] flex-col overflow-hidden rounded-[30px] border border-violet-500/25 bg-[#090911] shadow-2xl dashboard:hidden"
              initial={{ y: "110%", opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: "110%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 330, damping: 34 }}>
              <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/25" aria-hidden="true" />
              <div className="min-h-0 flex-1 overflow-hidden">
                <Suspense fallback={<div role="status" className="flex h-full items-center justify-center text-sm text-white/70">Preparando o registro...</div>}>
                  <SmartRegister embedded />
                </Suspense>
              </div>
            </motion.section>
          </>
        )}
      </AnimatePresence>

      <motion.nav
        initial={false}
        animate={{ opacity: registerOpen || visible ? 1 : 0, y: registerOpen || visible ? 0 : 90, scale: registerOpen ? 1 : visible ? (compact ? 0.94 : 1) : 0.94 }}
        transition={{ type: "spring", stiffness: 280, damping: 34, mass: 0.85 }}
        className={cn(
          "fixed inset-x-0 bottom-[max(0.7rem,env(safe-area-inset-bottom))] z-40 flex justify-center px-3 dashboard:hidden",
          !visible && !registerOpen && "pointer-events-none"
        )}
        data-testid="mobile-nav"
      >
        <div className="flex w-full max-w-[28rem] items-center gap-2.5">
          <div style={{ gridTemplateColumns: mobileItems.map((_, index) => `${index === activeIndex ? 2.35 : 1}fr`).join(" ") || "1fr" }}
          className={cn("grid min-w-0 flex-1 items-center rounded-full border border-white/50 bg-[#eeeeee]/75 p-[3px] shadow-[0_4px_22px_rgba(0,0,0,.08)] backdrop-blur-[28px] transition-[background-color,box-shadow] duration-300 dark:border-white/15 dark:bg-[#161625]/75", compact && "bg-[#eeeeee]/45 shadow-[0_2px_12px_rgba(0,0,0,.05)]", registerOpen && "invisible pointer-events-none opacity-0")}>
            {mobileItems.map((item) => (
              <MobileTab key={item.to} item={item} onNavigate={navigateFromDock} />
            ))}
          </div>

          <button
            type="button"
            onClick={() => setRegisterOpen(open => !open)}
            className="flex h-[4.15rem] w-[4.15rem] shrink-0 items-center justify-center rounded-full bg-[#4B2CFF] text-white shadow-[0_4px_18px_rgba(75,44,255,.18)] transition-all duration-300 active:scale-95"
            aria-label={registerOpen ? "Fechar Registro Inteligente" : "Abrir Registro Inteligente"}
            aria-expanded={registerOpen}
            data-testid="mobile-quick-action-button"
          >
            <Plus className={cn("h-8 w-8 transition-transform duration-300", registerOpen && "rotate-45")} aria-hidden="true" />
          </button>
        </div>
      </motion.nav>
    </>
  );
}
