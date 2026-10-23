import { Route } from "react-router-dom";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import DashboardOverview from "@/pages/dashboard/DashboardOverview";
import DashboardSection from "@/pages/dashboard/DashboardSection";
import Accounts from "@/pages/Accounts";
import Cards from "@/pages/Cards";
import CardInvoice from "@/pages/CardInvoice";
import Subscriptions from "@/pages/Subscriptions";
import Transactions from "@/pages/Transactions";
import SettingsHub from "@/pages/SettingsHub";
import Settings from "@/pages/Settings";
import Onboarding from "@/pages/Onboarding";
import Budget from "@/pages/Budget";

/** Dashboard-specific route tree. Never import the FINNOS App shell here. */
export function dashboardRoutes() {
  return (
    <Route path="/dashboard" element={<DashboardShell />}>
      <Route index element={<DashboardOverview />} />
      <Route path="carteira" element={<DashboardSection section="carteira" />} />
      <Route path="contas" element={<Accounts />} />
      <Route path="cartoes" element={<Cards />} />
      <Route path="cartoes/:cardId" element={<CardInvoice />} />
      <Route path="assinaturas" element={<Subscriptions />} />
      <Route path="orcamento" element={<Budget />} />
      <Route path="cadastro-inicial" element={<Onboarding />} />
      <Route path="lancamentos" element={<Transactions />} />
      <Route path="transacoes" element={<DashboardSection section="transacoes" />} />
      <Route path="analises" element={<DashboardSection section="analises" />} />
      <Route path="radar" element={<DashboardSection section="radar" />} />
      <Route path="configuracoes" element={<SettingsHub />} />
      <Route path="configuracoes/avancado" element={<Settings />} />
    </Route>
  );
}
