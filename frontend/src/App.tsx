import { lazy, Suspense } from "react";
import { categoryFlowPath } from "@/lib/categoryLinks";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { FinnosLoading } from "@/components/brand/FinnosLoading";
import { AppShell } from "@/components/layout/AppShell";























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
const Subscriptions = lazy(() => import("@/pages/Subscriptions"));
const CardInvoice = lazy(() => import("@/pages/CardInvoice"));
const Radar = lazy(() => import("@/pages/Radar"));
const RadarDetail = lazy(() => import("@/pages/RadarDetail"));
const Onboarding = lazy(() => import("@/pages/Onboarding"));
const Analysis = lazy(() => import("@/pages/Analysis"));
const Patrimonio = lazy(() => import("@/pages/Patrimonio"));
const PreviewValidation = lazy(() => import("@/pages/PreviewValidation"));
const SmartRegister = lazy(() => import("@/pages/SmartRegister"));
const Login = lazy(() => import("@/pages/Login"));
const Register = lazy(() => import("@/pages/Register"));
const InsightDetail = lazy(() => import("@/pages/InsightDetail"));
const SettingsHub = lazy(() => import("@/pages/SettingsHub").then(module => ({ default: module.SettingsHub })));

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
/** Only for the very first chunk; inside the app shell pages use their own skeleton. */
function RouteFallback() {
  return <FinnosLoading fullscreen title="Abrindo o FINNOS" description="Carregando o módulo." />;
}

/** The old cash-flow address now opens the Caixa tab of Fluxo, with the same month and filters. */
function CaixaRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set("aba", "caixa");
  return <Navigate to={`/transacoes?${params.toString()}`} replace />;
}

/**
 * Análise used to have its own Evolução, Ritmo and Compromissos screens, and a Categorias screen that repeated
 * Fluxo › Análise. Each now has one home: the analysis of the library (or Fluxo for categories).
 */
function AnalysisRedirect({ to }: { to: string }) {
  const { search } = useLocation();
  const month = new URLSearchParams(search).get("month");
  if (to.startsWith("/transacoes")) return <Navigate to={`${to}${month ? `&month=${month}` : ""}`} replace />;
  return <Navigate to={to} replace />;
}

/** Old category address: a category is explored in Fluxo, filtered by it (Fluxo links on to Análise). */
function CategoryRedirect() {
  const { categoryId = "" } = useParams();
  return <Navigate to={categoryFlowPath(categoryId)} replace />;
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
            <Route path="/categorias/:categoryId" element={<CategoryRedirect />} />
            <Route path="/configuracoes" element={<SettingsHub />} />
            <Route path="/configuracoes/avancado" element={<Settings />} />
            <Route path="/configuracoes/:section" element={<Settings />} />
            <Route path="/configuracoes/integracoes" element={<SettingsIntegrations />} />
            <Route path="/configuracoes/graficos" element={<ChartSettings />} />
            <Route path="/cartoes" element={<Navigate to="/contas?aba=cartoes" replace />} />
            <Route path="/cartoes/:cardId" element={<CardInvoice />} />
            <Route path="/orcamento" element={<Budget />} />
            <Route path="/orcamento/configuracoes" element={<BudgetSettings />} />
            <Route path="/historico" element={<FinanceHistory />} />
            <Route path="/fluxo" element={<CaixaRedirect />} />
            <Route path="/radar" element={<Radar />} />
            <Route path="/radar/:signalId" element={<RadarDetail />} />
            <Route path="/assinaturas" element={<Subscriptions />} />
            <Route path="/analise" element={<Analysis />} />
            <Route path="/analise/evolucao" element={<AnalysisRedirect to="/analise/painel/seis-meses" />} />
            <Route path="/analise/categorias" element={<AnalysisRedirect to="/transacoes?aba=analise" />} />
            <Route path="/analise/ritmo" element={<AnalysisRedirect to="/analise/painel/habitos" />} />
            <Route path="/analise/compromissos" element={<AnalysisRedirect to="/analise/painel/compromissos" />} />
            <Route path="/analise/painel/:insightId" element={<InsightDetail />} />
            <Route path="/analise/painel" element={<Navigate to="/analise" replace />} />
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
