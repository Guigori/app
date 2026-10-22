import { Route } from "react-router-dom";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import DashboardOverview from "@/pages/dashboard/DashboardOverview";
import DashboardSection from "@/pages/dashboard/DashboardSection";

/** Dashboard-specific route tree. Never import the FINNOS App shell here. */
export function dashboardRoutes() {
  return (
    <Route path="/dashboard" element={<DashboardShell />}>
      <Route index element={<DashboardOverview />} />
      <Route path="carteira" element={<DashboardSection section="carteira" />} />
      <Route path="transacoes" element={<DashboardSection section="transacoes" />} />
      <Route path="analises" element={<DashboardSection section="analises" />} />
      <Route path="radar" element={<DashboardSection section="radar" />} />
      <Route path="configuracoes" element={<DashboardSection section="configuracoes" />} />
    </Route>
  );
}
