import { Outlet } from "react-router-dom";
import { AiPanel } from "@/components/ai/AiPanel";
import { DialogsProvider } from "@/components/dialogs/DialogsProvider";
import { BackButton } from "@/components/layout/BackButton";
import { Header } from "@/components/layout/Header";
import { MobileNav } from "@/components/layout/MobileNav";
import { QuickActionFAB } from "@/components/layout/QuickActionFAB";
import { Sidebar } from "@/components/layout/Sidebar";

export function AppShell() {
  return (
    <DialogsProvider>
      <div className="min-h-svh bg-background">
        <Sidebar />
        <div className="lg:pl-64">
          <Header />
          <main className="mx-auto w-full max-w-7xl px-4 py-5 pb-28 sm:px-6 lg:px-10 lg:pb-12">
            {/* Mobile keeps the back control inside the content column */}
            <div className="mb-1 lg:hidden">
              <BackButton />
            </div>
            <Outlet />
          </main>
        </div>
        <MobileNav />
        <QuickActionFAB />
        <AiPanel />
      </div>
    </DialogsProvider>
  );
}
