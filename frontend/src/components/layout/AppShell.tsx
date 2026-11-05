import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { useLocation, useNavigate, useNavigationType, useOutlet } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { AiPanel } from "@/components/ai/AiPanel";
import { DialogsProvider } from "@/components/dialogs/DialogsProvider";
import { BackButton } from "@/components/layout/BackButton";
import { Header } from "@/components/layout/Header";
import { NavDrawer } from "@/components/layout/NavDrawer";
import { MobileNav } from "@/components/layout/MobileNav";
import { QuickActionFAB } from "@/components/layout/QuickActionFAB";
import { Sidebar } from "@/components/layout/Sidebar";
import { LocalNotificationPulse, NotificationPermissionPrompt } from "@/components/notifications/NotificationPermissionPrompt";
import { useEdgeSwipe } from "@/lib/useEdgeSwipe";
import { ConnectivityStatus } from "@/components/sync/ConnectivityStatus";
import { StatementImportHost } from "@/components/import/StatementImportHost";
import { startPreferencesSync } from "@/lib/preferencesSync";

export function AppShell() {
  const location = useLocation();
  // The leaving screen keeps the page it had: a live <Outlet> would draw the new page in it too,
  // leaving two copies on screen while it fades out.
  const outlet = useOutlet();
  const [menuOpen, setMenuOpen] = useState(false);
  // Dragging in from the left edge opens the menu, like Calen.
  useEdgeSwipe(useCallback(() => setMenuOpen(true), []), !menuOpen);
  // Like a native app: a new screen (and a reload) opens at the top; going back returns
  // to the exact scroll position the user left. Positions are kept per history entry.
  const navigationType = useNavigationType();
  // Dock shortcuts, Início panel and the "+" default follow the account to every device.
  useEffect(() => startPreferencesSync(), []);
  const navigate = useNavigate();
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

  return (
    <DialogsProvider>
      <div className="min-h-svh bg-background">
        <Sidebar />
        <div className="transition-[padding] duration-200 ease-out lg:pl-[var(--sidebar-w,16rem)]">
          <div className="lg:hidden"><Header onOpenMenu={() => setMenuOpen(true)} /></div>
          <main className="mx-auto w-full max-w-[1600px] px-4 py-5 pb-32 sm:px-6 lg:px-8 dashboard:pb-28">
            {/^\/radar\/[^/]+$/.test(location.pathname) || location.pathname === "/configuracoes" ? null : <BackButton />}
            {/* Each route fades/slides in, so navigation feels continuous instead of a jump. */}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                // A redirect (/cartoes → /contas) is the same screen: no exit/enter between them.
                key={location.pathname === "/cartoes" ? "/contas" : location.pathname}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                {/* Suspense inside the shell keeps sidebar and header in place while a page chunk loads. */}
                <Suspense fallback={<FinnosPageLoading title="Abrindo" />}>
                  {outlet}
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
        <div className="lg:hidden"><NavDrawer open={menuOpen} onOpenChange={setMenuOpen} /></div>
        <div className="lg:hidden"><MobileNav /></div>
        <QuickActionFAB />
        <AiPanel />
        <ConnectivityStatus />
        <StatementImportHost />
        <NotificationPermissionPrompt />
        <LocalNotificationPulse />
      </div>
    </DialogsProvider>
  );
}
