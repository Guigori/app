/**
 * O mês que acabou, contado inteiro: como fechou (do saldo inicial ao final), resumo, lançamentos do Fluxo,
 * previsto × aconteceu e o que mudou depois do fechamento. Usado no Histórico e na tela do livre quando o mês já
 * terminou.
 */
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ImageDown, Printer, Share2 } from "lucide-react";
import { exportNodeImage } from "@/lib/exportImage";
import { toast } from "sonner";
import { fetchAccounts, fetchBalanceHistory, fetchBudget, fetchTransactions, fetchTrends } from "@/lib/data";
import { addMonth, currentMonth, monthLabel } from "@/lib/format";
import { buildMonthFlow } from "@/lib/budget/closing";
import type { BudgetClosing } from "@/lib/budget/server";
import { useBudgetClosings, useBudgetPlans } from "@/components/budget/usePlans";
import { BulletBar } from "@/components/charts/FinnosCharts";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { TransactionList } from "@/components/transactions/TransactionList";
import { Segmented } from "@/components/budget/desktop/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const mName = (m: string) => NAMES[Number(m.slice(5)) - 1];
type Tab = "resumo" | "lancamentos" | "previsto" | "mudancas";

export function MonthStory({ month, money, desktop, hideOpenNote }: { month: string; money: (n: number) => string; desktop: boolean; hideOpenNote?: boolean }) {
  const [tab, setTab] = useState<Tab>("resumo");
  const storyRef = useRef<HTMLDivElement>(null);
  const [imaging, setImaging] = useState(false);
  const saveImage = async () => {
    if (!storyRef.current) return;
    setImaging(true);
    try { const r = await exportNodeImage(storyRef.current, `finnos-${month}`, `${monthLabel(month)} no FINNOS`); if (r === "downloaded") toast.success("Imagem salva."); }
    catch { toast.error("Não deu para gerar a imagem agora."); }
    finally { setImaging(false); }
  };
  const [lf, setLf] = useState<"todas" | "entradas" | "saidas">("todas");
  const closings = useBudgetClosings();
  const plans = useBudgetPlans();
  const last = addMonth(currentMonth(), -1);
  const trends = useQuery({ queryKey: ["trends", 12, last], queryFn: () => fetchTrends(12, last) });
  const txs = useQuery({ queryKey: ["transactions", { month }], queryFn: () => fetchTransactions({ month }) });
  const budget = useQuery({ queryKey: ["budget", month], queryFn: () => fetchBudget(month) });
  const balance = useQuery({ queryKey: ["balance-history", month], queryFn: () => fetchBalanceHistory(month) });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const closing = closings.closingOf(month);
  const plan = plans.planOf(month);
  const hasPlan = plan.planned_income > 0 || plan.planned_bills > 0;
  const t = trends.data?.months.find((x) => x.month === month);
  const sel = t || closing ? { income: closing?.earned ?? t?.income ?? 0, expense: closing?.spent ?? t?.expense ?? 0, result: closing?.result ?? ((t?.income ?? 0) - (t?.expense ?? 0)) } : null;
  const flow = useMemo(() => (txs.data && balance.data && accounts.data ? buildMonthFlow({ month, transactions: txs.data, benefitIds: new Set(accounts.data.filter((a) => a.type === "beneficio").map((a) => a.id)), opening: balance.data.opening_balance, closing: balance.data.balance }) : null), [txs.data, balance.data, accounts.data, month]);

  // What changed in the month after it was closed: totals and categories now × the snapshot.
  const changes = useMemo(() => {
    if (!closing || !budget.data) return [];
    const now = new Map(budget.data.rows.map((r) => [r.category_id, r]));
    const out: { label: string; before: number; after: number }[] = [];
    const t = trends.data?.months.find((x) => x.month === month);
    if (t && Math.abs(t.income - closing.earned) >= 0.01) out.push({ label: "Entrou", before: closing.earned, after: t.income });
    if (t && Math.abs(t.expense - closing.spent) >= 0.01) out.push({ label: "Saiu", before: closing.spent, after: t.expense });
    for (const c of closing.categories) { const r = now.get(c.category_id); if (r && Math.abs(r.spent - c.spent) >= 0.01) out.push({ label: c.name, before: c.spent, after: r.spent }); }
    return out;
  }, [closing, budget.data, trends.data, month]);
  const updateSnapshot = () => {
    if (!closing || !budget.data) return;
    const t = trends.data?.months.find((x) => x.month === month);
    const earned = t?.income ?? closing.earned, spent = t?.expense ?? closing.spent;
    const next: BudgetClosing = { ...closing, earned, spent, result: Math.round((earned - spent) * 100) / 100,
      categories: closing.categories.map((c) => ({ ...c, spent: budget.data!.rows.find((r) => r.category_id === c.category_id)?.spent ?? c.spent })) };
    closings.close.mutate(next, { onSuccess: () => toast.success("Retrato do mês atualizado.") });
  };
  const share = async () => {
    if (!sel) return;
    const text = `${monthLabel(month)}: entrou ${money(sel.income)}, saiu ${money(sel.expense)}, ${sel.result >= 0 ? "sobrou" : "faltou"} ${money(Math.abs(sel.result))}.`;
    if (navigator.share) { try { await navigator.share({ title: `Histórico de ${mName(month)}`, text }); } catch { /* cancelled */ } } else { await navigator.clipboard?.writeText(text); toast.success("Resumo copiado."); }
  };


  const decisions = closing ? [
    ...closing.allocation.map((a) => `Sobra de ${money(a.value)} para ${a.kind === "meta" ? `a meta ${a.name}` : a.name}`),
  ] : [];
  if (!sel) return <FinnosPageLoading title="Carregando o mês" description="Juntando o que aconteceu." />;
  const cats = closing?.categories ?? (budget.data?.rows ?? []).filter((r) => r.group !== "metas" && (r.budget > 0 || r.spent > 0)).map((r) => ({ category_id: r.category_id, name: r.name, spent: r.spent, limit: r.budget }));
  return (
    <div ref={storyRef} className="bg-card">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented label="Parte do mês" value={tab} onChange={setTab} options={[["resumo", "Resumo"], ["lancamentos", "Lançamentos"], ["previsto", "Previsto"], ["mudancas", `Mudanças${changes.length ? ` (${changes.length})` : ""}`]] as const} />
        <span className="flex-1" />
        <Button size="sm" variant="outline" className="rounded-full" onClick={() => window.print()} data-export-skip="true"><Printer className="h-3.5 w-3.5" /> PDF</Button>
        <Button size="sm" variant="outline" className="rounded-full" onClick={saveImage} disabled={imaging} data-export-skip="true" data-testid="story-image"><ImageDown className="h-3.5 w-3.5" /> {imaging ? "Gerando…" : "Imagem"}</Button>
        <Button size="sm" variant="outline" className="rounded-full" onClick={share} data-export-skip="true"><Share2 className="h-3.5 w-3.5" /> Enviar</Button>
      </div>
      {closing && changes.length ? (
        <p className="mb-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" data-testid="month-stale">
          <strong className="block">Mudou depois do fechamento</strong>{changes.length} {changes.length === 1 ? "valor mudou" : "valores mudaram"} desde {closing.closed_at.slice(8, 10)}/{closing.closed_at.slice(5, 7)}. O retrato do fechamento continua guardado; veja em <button type="button" className="font-semibold underline" onClick={() => setTab("mudancas")}>Mudanças</button>.
        </p>
      ) : null}
      {tab === "resumo" ? (
        <div className="flex flex-col gap-4">
          <section aria-label="Como foi o mês" className="rounded-xl bg-primary/[0.05] p-3.5" data-testid="month-story-text">
            <p className="text-sm font-semibold">Como foi {mName(month)}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{storyOf({ name: mName(month), income: sel.income, expense: sel.expense, result: sel.result, plannedIncome: hasPlan ? closing?.planned_income ?? plan.planned_income : null, plannedBills: hasPlan ? closing?.planned_bills ?? plan.planned_bills : null, over: cats.filter((c) => c.limit > 0 && c.spent > c.limit).map((c) => c.name), closed: Boolean(closing) }, money)}</p>
          </section>
          {flow ? (
            <section aria-label="Como fechou" data-testid="month-flow">
              <p className="mb-2 text-sm font-semibold">Como {mName(month)} fechou nas contas</p>
              <ul className="overflow-hidden rounded-xl border border-border text-[13px]">
                {([["", "Começou o mês com", flow.opening, "base"], ["+", "Entrou", flow.income, "in"], ["−", "Contas fixas, parcelas e agendados", flow.bills, "out"], ["−", "Faturas de cartão pagas", flow.invoices, "out"], ["−", "Dia a dia no débito, Pix e dinheiro", flow.daily, "out"],
                  ...(Math.abs(flow.other) >= 0.01 ? [[flow.other >= 0 ? "+" : "−", "Outros movimentos (transferências, ajustes)", Math.abs(flow.other), "other"] as const] : []),
                  ["=", "Terminou com", flow.closing, "total"]] as const).map(([sign, label, value, kind]) => (
                  <li key={label} className={cn("flex items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0", kind === "total" && "bg-primary/5 font-semibold")}>
                    <span className={cn("w-4 text-center font-heading font-bold", kind === "out" ? "text-expense" : kind === "in" ? "text-income" : "")}>{sign}</span>
                    <span className="flex-1">{label}</span>
                    <span className="whitespace-nowrap tabular-nums">{money(value)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-muted-foreground">Saldos das contas (sem vales). Compras no cartão entram pela fatura paga.{sel && flow && Math.abs(sel.income - flow.income) >= 0.01 ? ` O Entrou abaixo (${money(sel.income)}) inclui ${money(sel.income - flow.income)} que caiu nos vales.` : ""}{(closing?.allocation ?? []).length ? ` Sobra destinada no fechamento: ${closing!.allocation.map((a) => `${a.name} ${money(a.value)}`).join(", ")}.` : ""}</p>
            </section>
          ) : null}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([["Entrou", `+ ${money(sel.income)}`, "text-income"], ["Saiu", `− ${money(sel.expense)}`, ""], [sel.result >= 0 ? "Sobrou" : "Faltou", money(Math.abs(sel.result)), sel.result >= 0 ? "text-primary" : "text-expense"], ["Guardado em metas", money((closing?.allocation ?? []).filter((a) => a.kind === "meta").reduce((s, a) => s + a.value, 0)), ""]] as const).map(([l, v, cl]) => <div key={l} className="rounded-xl bg-muted/50 px-3.5 py-3"><dt className="text-xs text-muted-foreground">{l}</dt><dd className={cn("mt-0.5 font-heading text-base font-semibold tabular-nums", cl)}>{v}</dd></div>)}
          </dl>
          {!closing ? (hideOpenNote ? null : <p className="text-[13px] text-muted-foreground">{mName(month)} ainda não foi fechado no Orçamento. <Link to={`/orcamento/fechar?mes=${month}`} className="font-semibold text-primary">Fechar {mName(month)}</Link></p>) : <p className="text-xs text-muted-foreground">Fechado em {closing.closed_at.slice(8, 10)}/{closing.closed_at.slice(5, 7)}.{closing.allocation.length ? ` Sobra: ${closing.allocation.map((a) => `${a.name} ${money(a.value)}`).join(", ")}.` : ""}</p>}
          <ul className="flex flex-col gap-3">
            {cats.filter((c) => c.limit > 0 || c.spent > 0).map((c) => (
              <li key={c.category_id} className={cn(desktop && "grid grid-cols-[160px_1fr_180px] items-center gap-4")}>
                <span className="text-[13px] font-medium">{c.name}</span>
                {c.limit > 0 ? <BulletBar className={desktop ? "" : "mt-1.5"} value={c.spent} limit={c.limit} format={money} /> : <span className="text-xs text-muted-foreground">sem limite</span>}
                <span className={cn("text-xs tabular-nums", desktop ? "text-right" : "mt-1 block", c.limit > 0 && c.spent > c.limit ? "font-semibold text-expense" : "text-muted-foreground")}>{money(c.spent)}{c.limit > 0 ? ` de ${money(c.limit)}` : ""}</span>
              </li>
            ))}
          </ul>
          {closing ? (
            <section aria-label="Decisões do fechamento" className="rounded-xl border border-border p-3.5 text-[13px]" data-testid="month-decisions">
              <p className="text-sm font-semibold">Decisões do fechamento</p>
              {decisions.length ? <ul className="mt-1.5 space-y-1">{decisions.map((d) => <li key={d}>· {d}</li>)}</ul> : <p className="mt-1 text-muted-foreground">Nenhuma sobra destinada.</p>}
              {closing.note ? <><p className="mt-3 text-sm font-semibold">Observação</p><p className="mt-0.5 text-muted-foreground">{closing.note}</p></> : null}
            </section>
          ) : null}
        </div>
      ) : tab === "lancamentos" ? (
        <div>
          <div className="mb-3"><Segmented label="Filtrar" value={lf} onChange={setLf} options={[["todas", "Todas"], ["entradas", "Entradas"], ["saidas", "Saídas"]] as const} /></div>
          {!txs.data ? <FinnosPageLoading title="Carregando lançamentos" description="Do Fluxo." /> : <TransactionList transactions={txs.data.filter((t) => lf === "todas" || (lf === "entradas" ? t.type === "receita" : t.type === "despesa")).sort((a, b) => b.date.localeCompare(a.date))} />}
        </div>
      ) : tab === "previsto" ? (
        hasPlan ? (
          <table className="w-full text-sm"><thead><tr className="text-xs text-muted-foreground"><th className="py-1 text-left font-medium" /><th className="py-1 text-right font-medium">Previsto</th><th className="py-1 text-right font-medium">Aconteceu</th><th className="py-1 text-right font-medium">Diferença</th></tr></thead>
            <tbody className="divide-y divide-border">
              {([["Entrou", plan.planned_income, sel.income, true], ["Saiu", plan.planned_bills + (closing?.daily_planned ?? 0), sel.expense, false], ["Guardar em metas", plan.planned_saving, (closing?.allocation ?? []).filter((a) => a.kind === "meta").reduce((s, a) => s + a.value, 0), true]] as const).map(([l, p, r, more]) => {
                const d = r - p; const good = more ? d >= 0 : d <= 0;
                return <tr key={l}><td className="py-2 font-medium">{l}</td><td className="py-2 text-right tabular-nums text-muted-foreground">{money(p)}</td><td className="py-2 text-right font-semibold tabular-nums">{money(r)}</td><td className={cn("py-2 text-right tabular-nums", good ? "text-income" : "text-expense")}>{d >= 0 ? "+" : "−"}{money(Math.abs(d))}</td></tr>;
              })}
            </tbody></table>
        ) : <p className="text-[13px] text-muted-foreground">Sem plano salvo para {mName(month)}. O previsto aparece quando o mês é planejado em “Planejar o próximo mês”.</p>
      ) : (
        !closing ? <p className="text-[13px] text-muted-foreground">Mudanças aparecem depois que o mês é fechado: o retrato fica guardado e o FINNOS compara com o que mudou no Fluxo depois.</p>
          : changes.length ? (
            <div>
              <p className="mb-2 text-[13px] text-muted-foreground">Lançamentos de {mName(month)} foram alterados depois do fechamento. Você escolhe se o retrato acompanha.</p>
              <ul className="divide-y divide-border">{changes.map((c) => <li key={c.label} className="flex justify-between gap-3 py-2 text-sm"><span className="font-medium">{c.label}</span><span className="tabular-nums text-muted-foreground">{money(c.before)} → <strong className="text-foreground">{money(c.after)}</strong></span></li>)}</ul>
              <div className="mt-3 flex gap-2"><Button size="sm" className="rounded-full" onClick={updateSnapshot}>Atualizar retrato</Button><Button size="sm" variant="outline" className="rounded-full" onClick={() => setTab("resumo")}>Manter como fechou</Button></div>
            </div>
          ) : <p className="text-[13px] text-muted-foreground">Nada mudou desde o fechamento.</p>
      )}
    </div>
  );

}

/** A few plain sentences about the month, from its numbers (no AI, nothing sent anywhere). */
export function storyOf(m: { name: string; income: number; expense: number; result: number; plannedIncome: number | null; plannedBills: number | null; over: string[]; closed: boolean }, money: (v: number) => string): string {
  const parts: string[] = [];
  if (m.plannedIncome != null && m.plannedIncome > 0) {
    const d = m.income - m.plannedIncome;
    parts.push(Math.abs(d) < 1 ? `Entrou o que estava planejado (${money(m.income)}).` : d > 0 ? `Entrou ${money(d)} a mais que o planejado.` : `Entrou ${money(-d)} a menos que o planejado.`);
  } else parts.push(`Entrou ${money(m.income)} e saiu ${money(m.expense)}.`);
  parts.push(m.over.length ? `${m.over.join(", ")} ${m.over.length === 1 ? "passou" : "passaram"} do limite.` : "As categorias ficaram dentro do limite.");
  parts.push(m.result >= 0 ? `Sobrou ${money(m.result)}.` : `Faltou ${money(-m.result)}: saiu mais do que entrou.`);
  if (!m.closed) parts.push("O mês ainda não foi fechado no Orçamento.");
  return parts.join(" ");
}
