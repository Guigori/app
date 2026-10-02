import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { AiPanel } from "@/components/ai/AiPanel";
import { DialogsProvider } from "@/components/dialogs/DialogsProvider";
import { BackButton } from "@/components/layout/BackButton";
import { Header } from "@/components/layout/Header";
import { MobileNav } from "@/components/layout/MobileNav";
import { QuickActionFAB } from "@/components/layout/QuickActionFAB";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopTabs } from "@/components/layout/TopTabs";

export function AppShell() {
  const location = useLocation();

  return (
    <DialogsProvider>
      <div className="min-h-svh bg-background">
        <Sidebar />
        <div className="lg:pl-72">
          <Header />
          <TopTabs />
          <main className="mx-auto w-full max-w-7xl px-4 py-5 pb-32 sm:px-6 lg:px-10 lg:pb-12">
            {/* Mobile keeps the back control inside the content column */}
            <div className="mb-1 lg:hidden">
              <BackButton />
            </div>
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
        <MobileNav />
        <QuickActionFAB />
        <AiPanel />
      </div>
    </DialogsProvider>
  );
}
