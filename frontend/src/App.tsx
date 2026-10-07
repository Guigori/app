import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/layout/AppShell";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Dashboard from "@/pages/Dashboard";
import Transactions from "@/pages/Transactions";
import Accounts from "@/pages/Accounts";
import Categories from "@/pages/Categories";
import Settings from "@/pages/Settings";
import ChartSettings from "@/pages/ChartSettings";
import Budget from "@/pages/Budget";
import BudgetSettings from "@/pages/BudgetSettings";
import Flow from "@/pages/Flow";
import Cards from "@/pages/Cards";
import CardInvoice from "@/pages/CardInvoice";
import Subscriptions from "@/pages/Subscriptions";
import ComingSoon from "@/pages/ComingSoon";
import Radar from "@/pages/Radar";
import RadarDetail from "@/pages/RadarDetail";
import Onboarding from "@/pages/Onboarding";
import Analysis from "@/pages/Analysis";

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/cadastro" element={<Register />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/transacoes" element={<Transactions />} />
            <Route path="/contas" element={<Accounts />} />
            <Route path="/categorias" element={<Categories />} />
            <Route path="/configuracoes" element={<Settings />} />
            <Route path="/configuracoes/graficos" element={<ChartSettings />} />
            <Route path="/cartoes" element={<Cards />} />
            <Route path="/cartoes/:cardId" element={<CardInvoice />} />
            <Route path="/orcamento" element={<Budget />} />
            <Route path="/orcamento/configuracoes" element={<BudgetSettings />} />
            <Route path="/fluxo" element={<Flow />} />
            <Route path="/radar" element={<Radar />} />
            <Route path="/radar/:signalId" element={<RadarDetail />} />
            <Route path="/assinaturas" element={<Subscriptions />} />
            <Route path="/analise" element={<Analysis />} />
            <Route path="/metas" element={<ComingSoon module="metas" />} />
            <Route path="/investimentos" element={<ComingSoon module="investimentos" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
      {/* bottom-center keeps toasts clear of the right-side FAB/Finn cluster, which they
          would otherwise cover and swallow clicks on */}
      <Toaster richColors position="bottom-center" offset={{ bottom: "5.5rem" }} />
    </>
  );
}
