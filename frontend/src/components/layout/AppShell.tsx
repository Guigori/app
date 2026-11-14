import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { AppErrorBoundary } from "@/components/layout/ErrorBoundary";
import { useLocation, useNavigate, useNavigationType, useOutlet } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { AiPanel } from "@/components/ai/AiPanel";
import { DialogsProvider } from "@/components/dialogs/DialogsProvider";
import { BackButton, HeaderSlotProvider, declaredBack, useBack, useHeaderSlotState } from "@/components/layout/BackButton";
import { Header } from "@/components/layout/Header";
import { NavDrawer } from "@/components/layout/NavDrawer";
import { MobileNav } from "@/components/layout/MobileNav";
import { QuickActionFAB } from "@/components/layout/QuickActionFAB";
import { Sidebar } from "@/components/layout/Sidebar";
import { LocalNotificationPulse, NotificationPermissionPrompt } from "@/components/notifications/NotificationPermissionPrompt";
import { usePageGestures, type PageGestureHandlers, type PageGestureKind } from "@/lib/gestures/usePageGestures";
import { PullToRefresh } from "@/components/layout/PullToRefresh";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { navItemsFor, useNavigationPreferences } from "@/lib/navigationPreferences";
import { ConnectivityStatus } from "@/components/sync/ConnectivityStatus";
import { StatementImportHost } from "@/components/import/StatementImportHost";
import { InstallAppPrompt } from "@/components/layout/InstallAppPrompt";
import { startPreferencesSync } from "@/lib/preferencesSync";
import { rechargeBenefits } from "@/lib/data";
import { queryClient } from "@/lib/queryClient";
import { useTheme } from "next-themes";

/** A screen changed by a swipe slides in from the side the finger came from; otherwise it fades up. */
const pageVariants = {
  initial: (g: PageGestureKind | null) => (g === "next" ? { opacity: 0, x: 56, y: 0 } : g ? { opacity: 0, x: -56, y: 0 } : { opacity: 0, x: 0, y: 6 }),
  enter: { opacity: 1, x: 0, y: 0 },
  // The swiped-away screen already left with the finger: it must not reappear to fade out.
  exit: (g: PageGestureKind | null) => (g ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0 }),
};

export function AppShell() {
  const location = useLocation();
  // The leaving screen keeps the page it had: a live <Outlet> would draw the new page in it too,
  // leaving two copies on screen while it fades out.
  const outlet = useOutlet();
  const [menuOpen, setMenuOpen] = useState(false);
  // Like a native app: a new screen (and a reload) opens at the top; going back returns
  // to the exact scroll position the user left. Positions are kept per history entry.
  const navigationType = useNavigationType();
  // Dock shortcuts, Início panel and the "+" default follow the account to every device.
  useEffect(() => startPreferencesSync(), []);
  // Benefit recharges that came due (each one exists once, so running it again is harmless).
  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      rechargeBenefits().then((r) => { if (r.created.length) void queryClient.invalidateQueries(); }).catch(() => {});
    };
    run();
    document.addEventListener("visibilitychange", run);
    return () => document.removeEventListener("visibilitychange", run);
  }, []);
  // Light/dark follows the account too: tell the sync when it changes here, and apply it
  // when the account copy arrives (next-themes only reads its storage on start).
  const { theme, setTheme } = useTheme();
  useEffect(() => { if (theme) window.dispatchEvent(new Event("finnos-theme")); }, [theme]);
  useEffect(() => {
    const apply = () => {
      const saved = localStorage.getItem("theme");
      if (saved && saved !== theme) setTheme(saved);
    };
    window.addEventListener("finnos-theme", apply);
    return () => window.removeEventListener("finnos-theme", apply);
  }, [theme, setTheme]);
  const navigate = useNavigate();
  // Native-app gestures on phones: swipe right goes back on inner screens; on the bottom-bar tabs a
  // swipe moves to the tab beside and the left edge opens the menu; pulling down at the top refreshes.
  const nav = useBack();
  const tabs = navItemsFor(useNavigationPreferences().mobile);
  const tabIndex = tabs.findIndex((item) => item.to === location.pathname);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pullRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<PageGestureKind | null>(null);
  useEffect(() => {
    if (!gesture) return;
    const id = window.setTimeout(() => setGesture(null), 450);
    return () => window.clearTimeout(id);
  }, [gesture]);
  usePageGestures({
    surface: surfaceRef,
    pull: pullRef,
    enabled: !menuOpen,
    onCommit: setGesture,
    getHandlers: (): PageGestureHandlers => {
      const refresh = () => queryClient.refetchQueries({ type: "active" });
      const own = declaredBack();
      if (own) return { back: own, refresh };
      if (own === undefined && nav.show) return { back: nav.go, refresh };
      const menu = () => setMenuOpen(true);
      if (tabIndex < 0) return { menu, refresh };
      return {
        menu, refresh,
        prev: tabIndex > 0 ? () => navigate(tabs[tabIndex - 1].to) : undefined,
        next: tabIndex < tabs.length - 1 ? () => navigate(tabs[tabIndex + 1].to) : undefined,
      };
    },
  });
  // The entry the app opened on has no history key ("default"). Give it one, so coming
  // back to it (or reloading) restores the screen like any other entry.
  useEffect(() => {
    if (location.key !== "default") return;
    // A <Navigate> below may already have redirected (/cartoes → /contas?aba=cartoes): that entry
    // has its own key, and replacing it with this render's old address would undo the redirect.
    const here = `${location.pathname}${location.search}${location.hash}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== here) return;
    navigate(here, { replace: true, state: location.state });
  }, [location.key, location.pathname, location.search, location.hash, location.state, navigate]);
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  }, []);
  useEffect(() => {
    const key = location.key;
    const save = () => positions.current.set(key, window.scrollY);
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [location.key]);
  useLayoutEffect(() => {
    const saved = navigationType === "POP" ? positions.current.get(location.key) : undefined;
    if (!saved) {
      if (!location.hash) window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
      return;
    }
    // The page may still be loading its data: retry until it is tall enough (up to ~1.5 s).
    let tries = 0;
    let frame = 0;
    const restore = () => {
      window.scrollTo({ top: saved, left: 0, behavior: "instant" as ScrollBehavior });
      if (Math.abs(window.scrollY - saved) > 2 && tries++ < 90) frame = requestAnimationFrame(restore);
    };
    restore();
    return () => cancelAnimationFrame(frame);
  }, [location.key, location.hash, navigationType]);

  const [hasScreenHeader, setHasScreenHeader] = useHeaderSlotState();
  return (
    <HeaderSlotProvider onChange={setHasScreenHeader}>
    <DialogsProvider>
      <div className="min-h-svh bg-background">
        <Sidebar />
        <div className="transition-[padding] duration-200 ease-out lg:pl-[var(--sidebar-w,16rem)]">
          <div className="lg:hidden"><Header onOpenMenu={() => setMenuOpen(true)} /></div>
          <main className="mx-auto w-full max-w-[1600px] px-4 py-5 pb-32 sm:px-6 lg:px-8 dashboard:pb-28">
            {hasScreenHeader || /^\/radar\/[^/]+$/.test(location.pathname) ? null : <BackButton />}
            {/* Each route fades/slides in, so navigation feels continuous instead of a jump. */}
            <div ref={surfaceRef} data-testid="page-surface">
            <AnimatePresence mode="popLayout" initial={false} custom={gesture}>
              <motion.div
                // A redirect (/cartoes → /contas, /fluxo → Caixa in Fluxo) is the same screen: no exit/enter between them.
                key={location.pathname === "/cartoes" ? "/contas" : location.pathname === "/fluxo" ? "/transacoes" : location.pathname}
                custom={gesture}
                variants={pageVariants}
                initial="initial"
                animate="enter"
                exit="exit"
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                {/* Suspense inside the shell keeps sidebar and header in place while a page chunk loads. */}
                <AppErrorBoundary compact resetKey={location.pathname}>
                  <Suspense fallback={<FinnosPageLoading title="Abrindo" />}>
                    {outlet}
                  </Suspense>
                </AppErrorBoundary>
              </motion.div>
            </AnimatePresence>
            </div>
          </main>
        </div>
        <PullToRefresh ref={pullRef} />
        <div className="lg:hidden"><NavDrawer open={menuOpen} onOpenChange={setMenuOpen} /></div>
        <div className="lg:hidden"><MobileNav /></div>
        <QuickActionFAB />
        <AiPanel />
        <GlobalSearch />
        <ConnectivityStatus />
        <StatementImportHost />
        <NotificationPermissionPrompt />
        <InstallAppPrompt />
        <LocalNotificationPulse />
      </div>
    </DialogsProvider>
    </HeaderSlotProvider>
  );
}
