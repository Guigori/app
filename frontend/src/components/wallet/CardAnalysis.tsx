import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchBudget, fetchDashboard, fetchInvoice } from "@/lib/data";
import { cardGradient } from "@/lib/cardGradient";
import { formatBRL, formatHiddenBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CreditCard, Invoice } from "@/types/finnos";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Closing date of the cycle that closes in month ``ym`` (YYYY-MM). */
export function closingOf(card: Pick<CreditCard, "closing_day">, ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(Math.min(card.closing_day, new Date(y, m, 0).getDate())).padStart(2, "0")}`;
}
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Installments still running, read from the invoice lines ("6/12"). */
export function runningInstallments(invoice: Invoice | undefined) {
  if (!invoice) return [];
  return invoice.items.flatMap((item) => {
    const m = item.installment_label?.match(/(\d+)\s*\/\s*(\d+)/);
    if (!m) return [];
    const current = Number(m[1]), total = Number(m[2]);
    if (!(total > 1) || current > total) return [];
    const ends = shiftMonth(invoice.cycle_end.slice(0, 7), total - current);
    return [{ id: item.id, name: item.name.replace(/\s*[·-]?\s*\d+\s*\/\s*\d+\s*$/, ""), current, total, value: item.value, ends }];
  });
}

/** Prototype "5 · Análise do cartão": the card, last/current/next invoice, limit, best day,
 * weight in the month's budget and running installments. The tabs pick the invoice below. */
export function CardAnalysis({ card, selectedCycle, onPick, hidden }: {
  card: CreditCard;
  /** Closing date of the invoice shown below. */
  selectedCycle: string;
  onPick: (closing: string) => void;
  hidden: boolean;
}) {
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const openYm = card.next_closing.slice(0, 7);
  const cycles = [-1, 0, 1].map((d) => closingOf(card, shiftMonth(openYm, d)));
  const invoices = useQueries({ queries: cycles.map((c) => ({ queryKey: ["invoice", card.id, c], queryFn: () => fetchInvoice(card.id, c) })) });
  const [past, now, next] = invoices.map((q) => q.data);
  const month = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const dashboard = useQuery({ queryKey: ["dashboard", month], queryFn: () => fetchDashboard(month) });
  const budget = useQuery({ queryKey: ["budget", month], queryFn: () => fetchBudget(month), retry: false });

  const labels = ["Mês passado", "Este mês", "Próximo"];
  const picked = Math.max(0, cycles.indexOf(selectedCycle));
  const values = [past, now, next].map((i) => i?.total ?? 0);
  const max = Math.max(1, ...values);
  const note = (i: number) => {
    const inv = [past, now, next][i];
    if (!inv) return "";
    if (i === 0) return inv.paid ? `Paga em ${inv.paid_at ? ddmm(inv.paid_at) : "—"}.${now ? ` ${money(Math.abs(now.total - inv.total))} ${now.total >= inv.total ? "a menos" : "a mais"} que a atual.` : ""}`
      : (inv.outstanding ?? 0) > 0 ? `Ainda tem ${money(inv.outstanding ?? 0)} em aberto. Venceu em ${ddmm(inv.due_date)}.` : `Venceu em ${ddmm(inv.due_date)}.`;
    if (i === 1) {
      const diff = past && past.total > 0 ? Math.round(((inv.total - past.total) / past.total) * 100) : null;
      return `Fecha dia ${Number(inv.cycle_end.slice(8, 10))} e vence ${ddmm(inv.due_date)}.${diff !== null && diff !== 0 ? ` Está ${Math.abs(diff)}% ${diff > 0 ? "acima" : "abaixo"} de ${MONTHS[Number(past!.cycle_end.slice(5, 7)) - 1]}.` : ""}`;
    }
    const installments = runningInstallments(inv).reduce((s, x) => s + x.value, 0);
    return `${installments > 0 ? `Já tem ${money(installments)} de parcelas. ` : ""}Ainda vai crescer com as compras do mês.`;
  };
  const titleOf = (i: number) => {
    const inv = [past, now, next][i];
    const name = inv ? MONTHS[Number(inv.cycle_end.slice(5, 7)) - 1] : "";
    const state = i === 2 ? "prevista" : inv?.paid ? "paga" : i === 1 ? "aberta" : (inv?.outstanding ?? 0) > 0 ? "em aberto" : "fechada";
    return `Fatura de ${name} · ${state}`;
  };

  const usedPct = card.limit ? Math.min(100, Math.round((card.used / card.limit) * 100)) : 0;
  const best = Number(card.best_purchase_day.slice(8, 10));
  // Buying on the best day, the purchase is paid on the due date after the next closing.
  const nextDue = next?.due_date ?? card.next_due;
  const days = Math.round((Date.parse(`${nextDue}T12:00:00Z`) - Date.parse(`${card.best_purchase_day}T12:00:00Z`)) / 86400000);

  const expense = dashboard.data?.expense ?? 0;
  const share = now && expense > 0 ? Math.round((now.total / expense) * 100) : null;
  const byCategory = new Map<string, number>();
  for (const item of now?.items ?? []) if (!item.carry_from) byCategory.set(item.category_name ?? "Sem categoria", (byCategory.get(item.category_name ?? "Sem categoria") ?? 0) + item.value);
  const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, value]) => {
    const row = budget.data?.rows.find((r) => r.name === name);
    return { name, value, budget: row?.budget ?? 0 };
  });
  const running = runningInstallments(next ?? now);
  const committed = running.reduce((s, x) => s + x.value, 0);

  return (
    <div className="space-y-3.5" data-testid="card-analysis">
      <div className="flex h-[206px] flex-col justify-between rounded-3xl p-5 text-white shadow-[0_18px_40px_-18px_rgba(75,44,255,0.7)]" style={{ background: cardGradient(card.color) }} data-testid="card-art">
        <span><span className="block font-heading text-xl font-bold">{card.name}</span><span className="block text-xs opacity-85">{card.institution} · crédito</span></span>
        <div>
          <p className="text-[15px] tracking-[0.18em]">{card.last_digits ? `•••• ${card.last_digits}` : " "}</p>
          <div className="mt-3 flex justify-between text-xs opacity-90"><span>Limite de {money(card.limit)}</span><span>Fecha {card.closing_day} · Vence {card.due_day}</span></div>
        </div>
      </div>

      <section className="rounded-3xl border border-border bg-card p-4" data-testid="card-invoices">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Faturas</h2>
        <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-full bg-primary/[0.07] p-1">
          {labels.map((label, i) => (
            <button key={label} type="button" onClick={() => onPick(cycles[i])} aria-pressed={picked === i} data-testid={`card-invoice-tab-${i}`}
              className={cn("h-10 rounded-full text-[13px] font-semibold", picked === i ? "bg-card text-primary shadow-[0_1px_4px_rgba(7,15,82,0.12)]" : "text-muted-foreground")}>{label}</button>
          ))}
        </div>
        <div className="mt-4 flex h-[150px] items-end gap-[18px] px-2">
          {values.map((v, i) => (
            <button key={i} type="button" onClick={() => onPick(cycles[i])} aria-label={`${titleOf(i)}: ${money(v)}`}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <span className="text-xs font-bold tabular-nums">{hidden ? "•••" : v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : formatBRL(v).replace(/,\d\d$/, "")}</span>
              <span className={cn("block w-full max-w-16 rounded-t-xl rounded-b-md transition-all", picked === i ? "outline outline-2 outline-offset-2 outline-primary" : "opacity-80")}
                style={{ height: `${Math.max(4, Math.round((v / max) * 96))}px`, background: i === 2 ? "repeating-linear-gradient(135deg, #C9B5FF 0 6px, #E6DCFF 6px 12px)" : picked === i ? "var(--primary)" : "#C9C3FF" }} />
              <span className="text-xs text-muted-foreground">{[past, now, next][i] ? SHORT[Number([past, now, next][i]!.cycle_end.slice(5, 7)) - 1] : ""}</span>
            </button>
          ))}
        </div>
        <div className="mt-3.5 rounded-[18px] bg-primary/[0.07] p-3.5" data-testid="card-invoice-note">
          <p className="flex items-baseline justify-between gap-2"><span className="font-bold">{titleOf(picked)}</span><span className="font-heading text-xl font-bold tabular-nums">{money(values[picked])}</span></p>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{note(picked)}</p>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2.5">
        <div className="rounded-3xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Limite usado</p>
          <p className="mt-1 font-heading text-[22px] font-bold">{usedPct}%</p>
          <span className="mt-2.5 block h-2 overflow-hidden rounded-full bg-primary/10"><span className="block h-full rounded-full" style={{ width: `${usedPct}%`, background: card.color }} /></span>
          <p className="mt-2 text-xs text-muted-foreground"><span className="tabular-nums">{money(card.available)}</span> livres de <span className="tabular-nums">{money(card.limit)}</span></p>
        </div>
        <div className="rounded-3xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Melhor dia de compra</p>
          <p className="mt-1 font-heading text-[22px] font-bold">Dia {best}</p>
          <p className="mt-2.5 text-xs text-muted-foreground">Comprando a partir do dia {best}, você paga só em {Number(nextDue.slice(8, 10))} de {MONTHS[Number(nextDue.slice(5, 7)) - 1]}{days > 0 ? `: ${days} dias de prazo` : ""}.</p>
        </div>
      </section>

      {now && top.length ? (
        <section className="rounded-3xl border border-border bg-card p-4" data-testid="card-budget">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">No orçamento do mês</h2>
          <p className="mt-2.5 text-sm">{share !== null ? <>Esta fatura é <strong>{share}% dos seus gastos</strong> de {MONTHS[Number(month.slice(5, 7)) - 1]}. </> : null}O que mais pesou nela:</p>
          <div className="mt-3.5 flex flex-col gap-3">
            {top.map((t) => {
              const over = t.budget > 0 && t.value > t.budget;
              const pct = t.budget > 0 ? Math.min(100, Math.round((t.value / t.budget) * 100)) : Math.round((t.value / Math.max(1, now.total)) * 100);
              return (
                <div key={t.name}>
                  <p className="flex justify-between text-[13px]"><span>{t.name}</span>
                    <span><strong className={cn("tabular-nums", over && "text-expense")}>{money(t.value)}</strong>{t.budget > 0 ? <span className="text-muted-foreground"> de <span className="tabular-nums">{money(t.budget)}</span></span> : null}</span></p>
                  <span className={cn("mt-1.5 block h-2 overflow-hidden rounded-full", over ? "bg-expense/15" : "bg-primary/10")}><span className={cn("block h-full rounded-full", over ? "bg-expense" : "bg-primary")} style={{ width: `${pct}%` }} /></span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {running.length ? (
        <section className="rounded-3xl border border-border bg-card p-4" data-testid="card-installments">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Parcelas em andamento</h2>
          <div className="mt-3 flex flex-col gap-3.5">
            {running.map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.name}</span>
                  <span className="block text-xs text-muted-foreground">{p.current} de {p.total} · termina em {MONTHS[Number(p.ends.slice(5, 7)) - 1]}/{p.ends.slice(2, 4)}</span>
                  <span className="mt-1.5 flex gap-[3px]">{Array.from({ length: Math.min(p.total, 24) }, (_, i) => <span key={i} className="h-[5px] flex-1 rounded-[3px]" style={{ background: i < p.current ? card.color : `color-mix(in srgb, ${card.color} 15%, white)` }} />)}</span>
                </span>
                <strong className="shrink-0 text-sm tabular-nums">{hidden ? formatHiddenBRL() : `${formatBRL(p.value)}/mês`}</strong>
              </div>
            ))}
            <p className="text-xs text-muted-foreground"><span className="tabular-nums">{money(committed)}</span> por mês já estão comprometidos nas próximas faturas.</p>
          </div>
        </section>
      ) : null}
    </div>
  );
}
