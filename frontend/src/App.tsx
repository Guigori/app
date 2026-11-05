import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { FinnosLoading } from "@/components/brand/FinnosLoading";
import { AppShell } from "@/components/layout/AppShell";
import Login from "@/pages/Login";
import Register from "@/pages/Register";























const DashboardEntry = lazy(() => import("@/pages/DashboardEntry"));
const Transactions = lazy(() => import("@/pages/Transactions"));
const Accounts = lazy(() => import("@/pages/Accounts"));
const Categories = lazy(() => import("@/pages/Categories"));
const Settings = lazy(() => import("@/pages/Settings"));
const SettingsIntegrations = lazy(() => import("@/pages/SettingsIntegrations"));
const ChartSettings = lazy(() => import("@/pages/ChartSettings"));
const Budget = lazy(() => import("@/pages/Budget"));
const BudgetSettings = lazy(() => import("@/pages/BudgetSettings"));
const FinanceHistory = lazy(() => import("@/pages/FinanceHistory"));
const Flow = lazy(() => import("@/pages/Flow"));
const Cards = lazy(() => import("@/pages/Cards"));
const CardInvoice = lazy(() => import("@/pages/CardInvoice"));
const Subscriptions = lazy(() => import("@/pages/Subscriptions"));
const Radar = lazy(() => import("@/pages/Radar"));
const RadarDetail = lazy(() => import("@/pages/RadarDetail"));
const Onboarding = lazy(() => import("@/pages/Onboarding"));
const Analysis = lazy(() => import("@/pages/Analysis"));
const Patrimonio = lazy(() => import("@/pages/Patrimonio"));
const PreviewValidation = lazy(() => import("@/pages/PreviewValidation"));
const SmartRegister = lazy(() => import("@/pages/SmartRegister"));
const AnalysisEvolution = lazy(() => import("@/pages/analysis/AnalysisEvolution"));
const AnalysisCategories = lazy(() => import("@/pages/analysis/AnalysisCategories"));
const AnalysisRhythm = lazy(() => import("@/pages/analysis/AnalysisRhythm"));
const AnalysisCommitments = lazy(() => import("@/pages/analysis/AnalysisCommitments"));
const SettingsHub = lazy(() => import("@/pages/SettingsHub").then(module => ({ default: module.SettingsHub })));

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
/** Only for the very first chunk; inside the app shell pages use their own skeleton. */
function RouteFallback() {
  return <FinnosLoading fullscreen title="Abrindo o FINNOS" description="Carregando o módulo." />;
}

export default function App() {
  return (
    <>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/cadastro" element={<Register />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<DashboardEntry />} />
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
            <Route path="/historico" element={<FinanceHistory />} />
            <Route path="/fluxo" element={<Flow />} />
            <Route path="/radar" element={<Radar />} />
            <Route path="/radar/:signalId" element={<RadarDetail />} />
            <Route path="/assinaturas" element={<Subscriptions />} />
            <Route path="/analise" element={<Analysis />} />
            <Route path="/analise/evolucao" element={<AnalysisEvolution />} />
            <Route path="/analise/categorias" element={<AnalysisCategories />} />
            <Route path="/analise/ritmo" element={<AnalysisRhythm />} />
            <Route path="/analise/compromissos" element={<AnalysisCommitments />} />
            <Route path="/patrimonio" element={<Patrimonio />} />
            <Route path="/metas" element={<Patrimonio />} />
            <Route path="/investimentos" element={<Patrimonio />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
      </Suspense>
      {/* bottom-center keeps toasts clear of the right-side FAB/Finn cluster, which they
          would otherwise cover and swallow clicks on */}
      <Toaster richColors position="bottom-center" offset={{ bottom: "5.5rem" }} />
    </>
  );
}
