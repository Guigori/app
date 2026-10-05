import { useCallback, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { AiPanel } from "@/components/ai/AiPanel";
import { DialogsProvider } from "@/components/dialogs/DialogsProvider";
import { BackButton } from "@/components/layout/BackButton";
import { Header } from "@/components/layout/Header";
import { NavDrawer } from "@/components/layout/NavDrawer";
import { MobileNav } from "@/components/layout/MobileNav";
import { QuickActionFAB } from "@/components/layout/QuickActionFAB";
import { TopTabs } from "@/components/layout/TopTabs";
import { LocalNotificationPulse, NotificationPermissionPrompt } from "@/components/notifications/NotificationPermissionPrompt";
import { useEdgeSwipe } from "@/lib/useEdgeSwipe";

export function AppShell() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  // Dragging in from the left edge opens the menu, like Calen.
  useEdgeSwipe(useCallback(() => setMenuOpen(true), []), !menuOpen);

  return (
    <DialogsProvider>
      <div className="min-h-svh bg-background">
        <div>
          <Header onOpenMenu={() => setMenuOpen(true)} />
          <TopTabs />
          <main className="mx-auto w-full max-w-7xl px-4 py-5 pb-32 sm:px-6 lg:px-10 dashboard:pb-28">
            {/^\/radar\/[^/]+$/.test(location.pathname) ? null : <BackButton />}
            {/* Each route fades/slides in, so navigation feels continuous instead of a jump. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
        <NavDrawer open={menuOpen} onOpenChange={setMenuOpen} />
        <MobileNav />
        <QuickActionFAB />
        <AiPanel />
        <NotificationPermissionPrompt />
        <LocalNotificationPulse />
      </div>
    </DialogsProvider>
  );
}
