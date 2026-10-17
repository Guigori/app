import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CheckCircle2, CreditCard, Landmark, Loader2, ShieldCheck, Sparkles, Upload, Wallet } from "lucide-react";
import { toast } from "sonner";
import { createTransaction, fetchAccounts, fetchCards, fetchCategories, fetchMe, updateMyName } from "@/lib/data";
import { apiPost } from "@/lib/api";
import { isLocalMode } from "@/lib/mode";
import { fetchOnboarding, saveOnboarding, type OnboardingPercentages } from "@/lib/onboarding";
import type { TransactionInput } from "@/types/finnos";
import { parseFinancialFile, type ImportRow } from "@/lib/importFinancial";
import { ImportReview } from "@/components/onboarding/ImportReview";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { CardDialog } from "@/components/cards/CardDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ImportMethod = "manual" | "statement" | "invoice";
const STEPS = [
  ["Seu nome", "Como você prefere ser chamado?"],
  ["Sua renda", "Uma referência para planejar o mês."],
  ["Seu orçamento", "Escolha o que faz sentido para você."],
  ["Sua carteira", "Adicione suas instituições e cartões."],
  ["Primeiro registro", "Conheça o lançamento sem criar dados fictícios."],
  ["Tudo pronto", "Explore as principais áreas do FINNOS."],
] as const;
const DEFAULT_PERCENT = { necessidades: 50, desejos: 30, metas: 20 };
function parseIncome(value: string): number | null {
  const text = value.trim().replace(/[^0-9,.-]/g, "");
  if (!text) return null;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const numeric = Number(normalized);
  const result = Math.round(numeric * 100);
  return Number.isSafeInteger(result) && result >= 0 && result <= 100000000000 ? result : null;
}
async function fingerprint(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash)).map((n) => n.toString(16).padStart(2, "0")).join("");
}

export default function Onboarding() {
  const navigate = useNavigate();
  const dialogs = useDialogs();
  const queryClient = useQueryClient();
  const local = isLocalMode();
  const stateQuery = useQuery({ queryKey: ["onboarding"], queryFn: fetchOnboarding, enabled: !local, retry: 1 });
  const userQuery = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const cardsQuery = useQuery({ queryKey: ["cards"], queryFn: fetchCards });
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const accounts = accountsQuery.data ?? [];
  const cards = cardsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const [hydrated, setHydrated] = useState(local);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [nameHydrated, setNameHydrated] = useState(false);
  const [income, setIncome] = useState("");
  const [mode, setMode] = useState<"503020" | "personalizado">("503020");
  const [percentages, setPercentages] = useState<OnboardingPercentages>(DEFAULT_PERCENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cardOpen, setCardOpen] = useState(false);
  const [method, setMethod] = useState<ImportMethod>("manual");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [cardId, setCardId] = useState("");
  const [importError, setImportError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const targetAccountId = accountId || accounts[0]?.id || "";

  useEffect(() => {
    if (!stateQuery.data || hydrated) return;
    const state = stateQuery.data;
    setStep(Math.max(0, Math.min(5, state.step)));
    setIncome(state.income_cents == null ? "" : String(state.income_cents / 100));
    setMode(state.budget_mode);
    setPercentages(state.budget_percentages ?? DEFAULT_PERCENT);
    setHydrated(true);
  }, [stateQuery.data, hydrated]);
  useEffect(() => {
    if (userQuery.data && !nameHydrated) {
      setName(userQuery.data.name);
      setNameHydrated(true);
    }
  }, [userQuery.data, nameHydrated]);

  const persist = async (nextStep: number, extra: Record<string, unknown> = {}) => {
    if (local) {
      window.localStorage.setItem("finnos:onboarding:local", JSON.stringify({ step: nextStep, ...extra }));
      return;
    }
    const next = await saveOnboarding({
      status: nextStep >= STEPS.length ? "completed" : "in_progress",
      step: Math.min(nextStep, STEPS.length - 1),
      ...extra,
    });
    queryClient.setQueryData(["onboarding"], next);
  };

  const advance = async () => {
    setError("");
    setBusy(true);
    try {
      const extra: Record<string, unknown> = {};
      if (step === 0) {
        if (name.trim().length < 2 || name.trim().length > 60) throw new Error("Informe um nome de 2 a 60 caracteres.");
        if (name.trim() !== userQuery.data?.name) {
          await updateMyName(name.trim());
          await queryClient.invalidateQueries({ queryKey: ["me"] });
        }
      }
      if (step === 1) {
        if (income.trim() && parseIncome(income) == null) throw new Error("Informe uma renda válida.");
        if (income.trim()) extra.income_cents = parseIncome(income);
      }
      if (step === 2) {
        const effective = mode === "503020" ? DEFAULT_PERCENT : percentages;
        if (Object.values(effective).some(v => !Number.isInteger(v) || v < 0 || v > 100) ||
          effective.necessidades + effective.desejos + effective.metas !== 100)
          throw new Error("Os três percentuais precisam somar 100%.");
        extra.budget_mode = mode;
        extra.budget_percentages = effective;
      }
      if (step === 4) extra.first_entry_seen = true;
      if (step === 5) extra.tour_seen = true;
      await persist(step + 1, extra);
      if (step === 5) {
        toast.success("Seu FINNOS está preparado!");
        navigate("/", { replace: true });
      } else {
        setStep(step + 1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    setBusy(true);
    setError("");
    try {
      if (local) window.localStorage.setItem("finnos:onboarding:local", JSON.stringify({ status: "skipped", step }));
      else {
        const saved = await saveOnboarding({ status: "skipped", step });
        queryClient.setQueryData(["onboarding"], saved);
      }
      navigate("/", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível adiar a configuração.");
    } finally { setBusy(false); }
  };

  const goBack = async () => {
    if (!step || busy) return;
    try {
      await persist(step - 1);
      setStep(step - 1);
    } catch { setError("Não foi possível salvar sua posição."); }
  };

  const readFile = async (file: File) => {
    setImportError("");
    setFileName(file.name);
    try {
      if (!/\.(csv|ofx|qfx|txt)$/i.test(file.name)) throw new Error("Use CSV, OFX, QFX ou TXT. PDF ainda não é suportado.");
      const text = await file.text();
      const rows = parseFinancialFile(text, method === "invoice" ? "invoice" : "statement");
      const digest = await fingerprint(text);
      // Stable across devices/re-uploads. Server receipts are additionally scoped by verified UID.
      setImportRows(rows.map((row, index) => ({ ...row, id: digest + "-" + index })));
      if (!rows.length) setImportError("Nenhum lançamento reconhecido. Revise o formato do arquivo.");
    } catch (e) {
      setImportRows([]);
      setImportError(e instanceof Error ? e.message : "Falha ao analisar o arquivo.");
    }
  };

  const confirmImport = async () => {
    if (!targetAccountId || (method === "invoice" && !cardId)) {
      setImportError("Selecione uma conta e, para faturas, o cartão correspondente.");
      return;
    }
    const selected = importRows.filter(row => row.selected);
    if (!selected.length) return;
    setBusy(true);
    setImportError("");
    try {
      for (const row of selected) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !row.description.trim() || !Number.isFinite(row.value) || row.value <= 0)
          throw new Error("Revise datas, descrições e valores antes de importar.");
      }
      for (const row of selected) {
        const input: TransactionInput = {
          name: row.description.trim(), value: row.value, type: row.type,
          status: "pago", date: row.date, account_id: targetAccountId,
          card_id: method === "invoice" ? cardId : null,
          to_account_id: null, category_id: row.category_id,
          fixed: false, recurrence: null, installment: false,
          total_installments: null, current_installment: null,
          adjusted_value: null, attachment: fileName.slice(0, 300) || null,
          notes: "Importado durante o onboarding após revisão do usuário.",
        };
        if (local) {
          // Local mode is intentionally device-only; no server receipt is available.
          await createTransaction(input);
        } else {
          const operation = ["onboarding-import", targetAccountId, method === "invoice" ? cardId : "statement", row.id].join("-");
          await apiPost("/transactions", input, {
            "X-FINNOS-Operation-ID": operation, "X-FINNOS-Source": "import",
          });
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setStep(4);
      await persist(4);
      toast.success("Lançamentos importados. Confira-os no Fluxo.");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "A importação falhou. Nenhum novo lote será enviado automaticamente.");
    } finally { setBusy(false); }
  };

  if (!hydrated && !local) return <div className="mx-auto max-w-3xl py-16 text-center text-sm text-muted-foreground">{stateQuery.isError ? <><p>Não foi possível carregar sua configuração.</p><Button className="mt-4" onClick={() => void stateQuery.refetch()}>Tentar novamente</Button></> : "Carregando sua configuração..."}</div>;

  return <div className="mx-auto max-w-3xl space-y-5 pb-12" data-testid="onboarding-wizard">
    <div className="rounded-[28px] border border-primary/15 bg-gradient-to-br from-primary/10 via-card to-card p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary"><Sparkles className="h-4 w-4"/> Bem-vindo ao FINNOS</span>
        <span className="text-xs font-semibold text-muted-foreground">Etapa {step + 1} de 6</span>
      </div>
      <div className="mt-5 flex gap-1.5" aria-label="Progresso do onboarding">
        {STEPS.map((item, index) => <span key={item[0]} className={"h-1.5 flex-1 rounded-full " + (index <= step ? "bg-primary" : "bg-primary/15")} />)}
      </div>
      <h1 className="mt-6 font-heading text-2xl font-bold sm:text-3xl">{STEPS[step][0]}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{STEPS[step][1]}</p>
      {step === 0 && <p className="mt-4 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mr-1 inline h-4 w-4 text-primary"/> Seus dados financeiros ficam vinculados à sua conta e não serão compartilhados com outros usuários. Você decide o que registrar.</p>}
    </div>

    <Card><CardContent className="space-y-5 p-5 sm:p-7">
      {step === 0 && <div className="space-y-3">
        <Label htmlFor="onboard-name">Como podemos chamar você?</Label>
        <Input id="onboard-name" autoComplete="given-name" value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="Seu nome preferido" className="h-12 rounded-xl" />
        <p className="text-xs text-muted-foreground">Pode alterar esse nome quando quiser nas configurações.</p>
      </div>}
      {step === 1 && <div className="space-y-3">
        <Label htmlFor="onboard-income">Qual é sua renda mensal aproximada?</Label>
        <Input id="onboard-income" inputMode="decimal" value={income} onChange={e => setIncome(e.target.value)} placeholder="Ex.: 3100,00" className="h-12 rounded-xl" />
        <p className="text-xs text-muted-foreground">Esse valor é uma referência de planejamento, não uma receita lançada automaticamente. Você pode deixar em branco.</p>
      </div>}
      {step === 2 && <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {([["503020", "50 / 30 / 20", "50% necessidades · 30% desejos · 20% futuro"], ["personalizado", "Personalizado", "Escolha sua própria distribuição"]] as const).map(([key, title, description]) =>
            <button key={key} type="button" onClick={() => { setMode(key); if (key === "503020") setPercentages(DEFAULT_PERCENT); }} className={"rounded-2xl border p-4 text-left " + (mode === key ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
              <p className="font-semibold">{title}</p><p className="mt-2 text-xs text-muted-foreground">{description}</p>
            </button>)}
        </div>
        <div className="space-y-3">
          {(["necessidades", "desejos", "metas"] as const).map(key => <label className="flex items-center justify-between gap-3" key={key}>
            <span className="text-sm font-medium">{key === "metas" ? "Futuro / Metas" : key === "desejos" ? "Desejos" : "Necessidades"}</span>
            <span className="flex items-center gap-2"><Input type="number" min={0} max={100} step={1} className="h-10 w-24 text-right" disabled={mode === "503020"} value={(mode === "503020" ? DEFAULT_PERCENT : percentages)[key]} onChange={e => setPercentages(prev => ({ ...prev, [key]: Number(e.target.value) }))} />%</span>
          </label>)}
          <p className="text-right text-xs text-muted-foreground">Total: {Object.values(mode === "503020" ? DEFAULT_PERCENT : percentages).reduce((a,b) => a+b,0)}%</p>
        </div>
        <p className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">A proporção será salva no seu perfil. Os limites específicos de categorias são configurados em Orçamento, sem gerar despesas fictícias.</p>
      </div>}
      {step === 3 && <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border p-4">
            <Landmark className="h-5 w-5 text-primary"/>
            <p className="mt-2 font-semibold">Contas bancárias</p>
            <p className="mt-1 text-xs text-muted-foreground">{accounts.length} cadastrada(s)</p>
            <Button className="mt-4 w-full" variant="outline" onClick={() => dialogs.openAccount()}>Adicionar conta</Button>
          </div>
          <div className="rounded-2xl border border-border p-4">
            <CreditCard className="h-5 w-5 text-primary"/>
            <p className="mt-2 font-semibold">Cartões de crédito</p>
            <p className="mt-1 text-xs text-muted-foreground">{cards.length} cadastrado(s)</p>
            <Button className="mt-4 w-full" variant="outline" onClick={() => setCardOpen(true)}>Adicionar cartão</Button>
          </div>
        </div>
        {(accounts.length > 0 || cards.length > 0) && <div className="rounded-xl bg-muted/50 p-3 text-sm">{accounts.map(a => <p key={a.id} className="py-1"><Wallet className="mr-2 inline h-4 w-4 text-primary"/>{a.institution || "Instituição"} · {a.name}</p>)}{cards.map(c => <p key={c.id} className="py-1"><CreditCard className="mr-2 inline h-4 w-4 text-primary"/>{c.institution || "Instituição"} · {c.name}</p>)}</div>}
        <div className="border-t border-border pt-5">
          <h3 className="font-semibold">Como deseja começar?</h3>
          <p className="mt-1 text-xs text-muted-foreground">O cadastro manual não exige extrato. Você poderá importar dados depois.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {([["manual","Manual"],["statement","Extrato"],["invoice","Fatura"]] as const).map(([key,label]) => <button key={key} type="button" onClick={() => { setMethod(key); setImportRows([]); setImportError(""); }} className={"rounded-xl border px-3 py-3 text-sm font-medium " + (method === key ? "border-primary bg-primary/10" : "border-border")}>{label}</button>)}
          </div>
          {method !== "manual" && <div className="mt-4 space-y-3">
            <input type="file" ref={inputRef} accept=".csv,.ofx,.qfx,.txt" className="hidden" onChange={e => { const f=e.target.files?.[0];if(f)void readFile(f); }} />
            <Button variant="outline" onClick={() => inputRef.current?.click()}><Upload className="h-4 w-4"/> Selecionar {method === "invoice" ? "fatura" : "extrato"}</Button>
            <p className="text-xs text-muted-foreground">{fileName || "CSV, OFX, QFX e TXT. PDF ainda não é aceito."}</p>
            {method === "invoice" && <label className="block text-sm">Cartão da fatura<select className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-2" value={cardId} onChange={e => setCardId(e.target.value)}><option value="">Escolher cartão</option>{cards.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label>}
            {!!importRows.length && (method !== "invoice" || !!cardId) && <ImportReview rows={importRows} setRows={setImportRows} accounts={accounts} categories={categories} accountId={targetAccountId} setAccountId={setAccountId} onConfirm={confirmImport} busy={busy}/>}
            {importError && <p className="text-sm text-destructive" role="alert">{importError}</p>}
          </div>}
        </div>
      </div>}
      {step === 4 && <div className="space-y-4">
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">Exemplo — não será salvo</p>
          <p className="mt-3 text-lg font-semibold">Café da manhã</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">R$ 9,00</p>
          <p className="mt-2 text-sm text-muted-foreground">Despesa · Alimentação · Hoje</p>
        </div>
        <p className="text-sm text-muted-foreground">Para registrar uma compra real, utilize o botão + na navegação ou abra o cadastro de transações.</p>
        <Button variant="outline" onClick={() => dialogs.openTransaction({ type: "despesa" })}>Experimentar um lançamento real</Button>
        <p className="text-xs text-muted-foreground">Apenas um lançamento que você confirmar no formulário real será salvo.</p>
      </div>}
      {step === 5 && <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {([["Home","Resumo do seu dinheiro","/"],["Fluxo","Movimentações no tempo","/fluxo"],["Análises","Gráficos e descobertas","/analise"],["Metas e patrimônio","Seus objetivos","/patrimonio"],["Assinaturas","Serviços recorrentes","/assinaturas"],["Radar","Alertas importantes","/radar"]] as const).map(([title,desc,path]) =>
            <div key={title} className="rounded-2xl border border-border p-4"><p className="font-semibold">{title}</p><p className="mt-1 text-xs text-muted-foreground">{desc}</p><p className="mt-2 text-[11px] text-primary">{path}</p></div>)}
        </div>
        <p className="text-xs text-muted-foreground"><ShieldCheck className="mr-1 inline h-4 w-4 text-primary" />As operações financeiras permanecem privadas na sua conta. Você pode ajustar as configurações a qualquer momento.</p>
      </div>}
      {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <div className="flex items-center gap-3">
          {step > 0 && <Button variant="ghost" onClick={() => void goBack()} disabled={busy}><ArrowLeft className="h-4 w-4"/> Voltar</Button>}
          <button type="button" disabled={busy} onClick={() => void skip()} className="text-sm text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50">Deixar para depois</button>
        </div>
        <Button onClick={() => void advance()} disabled={busy || (step === 3 && importRows.length > 0 && method !== "manual")}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin"/> : step === 5 ? <CheckCircle2 className="h-4 w-4"/> : <ArrowRight className="h-4 w-4"/>}
          {step === 5 ? "Começar a usar FINNOS" : "Continuar"}
        </Button>
      </div>
      {step === 3 && importRows.length > 0 && method !== "manual" && <p className="text-xs text-muted-foreground">Confirme ou desmarque os lançamentos selecionados antes de avançar, ou escolha Manual.</p>}
    </CardContent></Card>
    <CardDialog open={cardOpen} onOpenChange={setCardOpen}/>
  </div>;
}
