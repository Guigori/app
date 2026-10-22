import { Navigate, Route } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { ExperienceHome } from "@/components/layout/ExperienceHome";
import Transactions from "@/pages/Transactions";
import Accounts from "@/pages/Accounts";
import Categories from "@/pages/Categories";
import Settings from "@/pages/Settings";
import { SettingsHub } from "@/pages/SettingsHub";
import SettingsIntegrations from "@/pages/SettingsIntegrations";
import ChartSettings from "@/pages/ChartSettings";
import Budget from "@/pages/Budget";
import BudgetSettings from "@/pages/BudgetSettings";
import Flow from "@/pages/Flow";
import Cards from "@/pages/Cards";
import CardInvoice from "@/pages/CardInvoice";
import Subscriptions from "@/pages/Subscriptions";
import Radar from "@/pages/Radar";
import RadarDetail from "@/pages/RadarDetail";
import Onboarding from "@/pages/Onboarding";
import Analysis from "@/pages/Analysis";
import Patrimonio from "@/pages/Patrimonio";
import PreviewValidation from "@/pages/PreviewValidation";
import SmartRegister from "@/pages/SmartRegister";

/** Existing FINNOS App routes remain unchanged and isolated from dashboard routes. */
export function appRoutes() {
  return (
    <Route element={<AppShell />}>
      <Route index element={<ExperienceHome />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/validacao-preview" element={<PreviewValidation />} />
      <Route path="/registro-inteligente" element={<SmartRegister />} />
      <Route path="/transacoes" element={<Transactions />} />
      <Route path="/contas" element={<Accounts />} />
      <Route path="/categorias" element={<Categories />} />
      <Route path="/configuracoes" element={<SettingsHub />} />
      <Route path="/configuracoes/avancado" element={<Settings />} />
      <Route path="/configuracoes/:section" element={<Settings />} />
      <Route path="/configuracoes/integracoes" element={<SettingsIntegrations />} />
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
      <Route path="/patrimonio" element={<Patrimonio />} />
      <Route path="/metas" element={<Patrimonio />} />
      <Route path="/investimentos" element={<Patrimonio />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  );
}
