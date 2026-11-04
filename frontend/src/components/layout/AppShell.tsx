import { Suspense, useCallback, useState } from "react";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { Outlet, useLocation } from "react-router-dom";
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

export function AppShell() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  // Dragging in from the left edge opens the menu, like Calen.
  useEdgeSwipe(useCallback(() => setMenuOpen(true), []), !menuOpen);

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
                key={location.pathname}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                {/* Suspense inside the shell keeps sidebar and header in place while a page chunk loads. */}
                <Suspense fallback={<FinnosPageLoading title="Abrindo" />}>
                  <Outlet />
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
        <NotificationPermissionPrompt />
        <LocalNotificationPulse />
      </div>
    </DialogsProvider>
  );
}
