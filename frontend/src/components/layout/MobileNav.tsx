import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { RegisterFab } from "@/components/layout/RegisterFab";
import { toast } from "sonner";
import { onRegisterSheet, type RegisterSheetRequest } from "@/lib/registerSheet";
import { DiscardRegisterDialog } from "@/components/layout/DiscardRegisterDialog";
import type { RegisterController } from "@/pages/SmartRegister";
const SmartRegister = lazy(() => import("@/pages/SmartRegister"));
import { cn } from "@/lib/utils";
import { type NavItem } from "@/components/layout/nav";
import { navItemsFor, useNavigationPreferences } from "@/lib/navigationPreferences";



/** Cash flow (/fluxo) is a detail screen of Fluxo (/transacoes); a card invoice belongs to Carteira. */
function isSubPage(to: string, pathname: string) {
  return (to === "/transacoes" && pathname.startsWith("/fluxo")) || (to === "/contas" && pathname.startsWith("/cartoes/"));
}

function MobileTab({ item, onNavigate }: { item: NavItem; onNavigate: (to: string) => void }) {
  const location = useLocation();
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(item.to);
      }}
      className={({ isActive: routeActive }) => {
        const isActive = routeActive || isSubPage(item.to, location.pathname);
        return cn(
          "relative flex h-[3.75rem] min-w-0 items-center justify-center overflow-hidden rounded-full px-1 transition-colors duration-200",
          isActive
            ? "bg-white text-primary shadow-[0_1px_4px_rgba(0,0,0,.035)] dark:bg-white/10 dark:text-[#A996FF] dark:shadow-none"
            : "text-[#626262] dark:text-white/70"
        );
      }}
      data-testid={`mobile-nav-${item.slug}`}
    >
      {({ isActive: routeActive }) => { const isActive = routeActive || isSubPage(item.to, location.pathname); return (
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
      ); }}
    </NavLink>
  );
}

export function MobileNav() {

  const navigationPreferences = useNavigationPreferences();
  const mobileItems = navItemsFor(navigationPreferences.mobile);
  const navigate = useNavigate();
  const location = useLocation();
  const activeIndex = mobileItems.findIndex((item) => item.to === location.pathname || isSubPage(item.to, location.pathname) || (item.to === "/" && location.pathname === "/"));

  const [registerOpen, setRegisterOpenRaw] = useState(false);
  const [controller, setController] = useState<RegisterController | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  // Opened from elsewhere (a lançamento tapped in a list, "Registrar outro" after editing one).
  const [request, setRequest] = useState<RegisterSheetRequest>({});
  const [requestKey, setRequestKey] = useState(0);
  useEffect(() => onRegisterSheet((r) => { setRequest(r); setRequestKey((k) => k + 1); setRegisterOpenRaw(true); }, false), []);
  const setRegisterOpen = (open: boolean) => { setRegisterOpenRaw(open); if (!open) { setController(null); setDiscardOpen(false); } };
  const entryDirty = registerOpen && controller?.view !== "success" && controller?.dirty;
  // Closing with something typed asks first; otherwise it just closes.
  const requestClose = () => { if (entryDirty) setDiscardOpen(true); else setRegisterOpen(false); };
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
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") requestClose(); };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previousOverflow; document.documentElement.style.overflow = previousHtmlOverflow; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerOpen, entryDirty]);

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
            <motion.button type="button" aria-label="Fechar registro" onClick={requestClose}
              className="fixed inset-0 z-[39] bg-black/40 backdrop-blur-[12px] dashboard:hidden"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />
            <motion.section role="dialog" aria-modal="true" aria-label="Novo registro"
              className={cn("fixed z-[40] mx-auto flex flex-col overflow-hidden bg-background transition-[top,bottom,left,right,border-radius] duration-300 ease-out dashboard:hidden",
                // Saved: the ✓ has grown over the screen, so the success screen takes all of it, as in the prototype.
                controller?.view === "success" || controller?.expanded ? "inset-0 pt-[env(safe-area-inset-top)]" : "inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] bottom-[calc(5.6rem+env(safe-area-inset-bottom))] max-w-[28rem] rounded-[36px] border border-border shadow-2xl")}
              // Grows out of the + button and goes back into it when it closes.
              style={{ transformOrigin: "calc(100% - 2.1rem) calc(100% + 2.85rem)" }}
              initial={{ scale: 0.06, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.06, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30, opacity: { duration: 0.18 } }}>
              {controller?.view === "success" || controller?.expanded ? null : <div className="absolute left-1/2 top-2 z-10 h-[5px] w-20 -translate-x-1/2 rounded-full bg-[#2a2b52]/70 dark:bg-[#2a2b52]" aria-hidden="true" />}
              <div className="min-h-0 flex-1 overflow-hidden">
                <Suspense fallback={<div role="status" className="flex h-full items-center justify-center text-sm text-muted-foreground">Preparando o registro...</div>}>
                  <SmartRegister key={requestKey} existing={request.existing} template={request.template} initialKind={request.kind} embedded onClose={() => setRegisterOpen(false)} onController={setController} />
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

          <RegisterFab open={registerOpen} dirty={Boolean(entryDirty)} kind={controller?.kind ?? "Despesa"} success={registerOpen && controller?.view === "success"}
            testId="mobile-quick-action-button" discardTestId="mobile-quick-action-discard" onDiscard={() => setDiscardOpen(true)}
            onMain={() => {
              if (!registerOpen) { setRequest({}); setRequestKey((k) => k + 1); setRegisterOpen(true); return; }
              if (controller?.view !== "success" && controller?.dirty) {
                if (controller.canSave && !controller.saving) controller.save();
                else toast(controller.hint ?? "Informe o valor para salvar");
                return;
              }
              setRegisterOpen(false);
            }} />
        </div>
      </motion.nav>
      <DiscardRegisterDialog open={discardOpen} kind={controller?.kind ?? "Despesa"} onKeep={() => setDiscardOpen(false)} onDiscard={() => setRegisterOpen(false)} />
    </>
  );
}
