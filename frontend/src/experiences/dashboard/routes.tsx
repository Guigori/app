import { Route } from "react-router-dom";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import DashboardOverview from "@/pages/dashboard/DashboardOverview";

/** Dashboard-specific route tree. Never import the FINNOS App shell here. */
export function dashboardRoutes() {
  return (
    <Route path="/dashboard" element={<DashboardShell />}>
      <Route index element={<DashboardOverview />} />
    </Route>
  );
}
