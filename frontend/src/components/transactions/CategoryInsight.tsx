import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Pencil, TrendingDown, TrendingUp } from "lucide-react";
import { fetchBudget, fetchCategories, fetchTransactions } from "@/lib/data";
import { addMonth, formatBRL, formatHiddenBRL, monthLabel, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import type { Transaction } from "@/types/finnos";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim();
const lastDay = (month: string) => { const [y, m] = month.split("-").map(Number); return new Date(y, m, 0).getDate(); };
const amount = (t: Transaction) => t.adjusted_value ?? t.value;

type Props = {
  categoryId: string;
  month: string;
  /** Everything spent in the month, to show how much of it this category is. */
  monthExpense?: number;
  onPickMonth?: (month: string) => void;
  onPickName?: (name: string) => void;
};

/** The analysis of one category inside Fluxo: the month against its limit, the last six months, where the money went, and how it was paid. */
export function CategoryInsight({ categoryId, month, monthExpense, onPickMonth, onPickName }: Props) {
  const dialogs = useDialogs();
  const { hidden } = useBalanceHidden();
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const first = addMonth(month, -5);
  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const category = categories.data?.find((c) => c.id === categoryId);
  const txs = useQuery({
    queryKey: ["transactions", "category-insight", categoryId, month],
    queryFn: () => fetchTransactions({ category_id: categoryId, start_date: `${first}-01`, end_date: `${month}-${lastDay(month)}` }),
    enabled: Boolean(categoryId),
    staleTime: 30_000,
  });
  const budget = useQuery({ queryKey: ["budget", month], queryFn: () => fetchBudget(month), staleTime: 30_000 });
  const row = budget.data?.rows.find((r) => r.category_id === categoryId);

  const data = useMemo(() => {
    const rows = (txs.data ?? []).filter((t) => t.type !== "transferencia" && t.category_id === categoryId);
    const months = Array.from({ length: 6 }, (_, i) => addMonth(month, i - 5));
    const bars = months.map((m) => ({ month: m, total: rows.filter((t) => t.date.slice(0, 7) === m).reduce((s, t) => s + amount(t), 0) }));
    const thisMonth = rows.filter((t) => t.date.slice(0, 7) === month);
    const paid = thisMonth.filter((t) => t.status === "pago").reduce((s, t) => s + amount(t), 0);
    const upcoming = thisMonth.filter((t) => t.status !== "pago").reduce((s, t) => s + amount(t), 0);
    const previous = bars.slice(0, -1).filter((b) => b.total > 0);
    const average = previous.length ? previous.reduce((s, b) => s + b.total, 0) / previous.length : 0;
    const group = (key: (t: Transaction) => string, label: (t: Transaction) => string) => {
      const map = new Map<string, { name: string; total: number; count: number }>();
      for (const t of thisMonth) { const k = key(t); const e = map.get(k) ?? { name: label(t), total: 0, count: 0 }; e.total += amount(t); e.count += 1; map.set(k, e); }
      return [...map.values()].sort((a, b) => b.total - a.total);
    };
    const top = group((t) => norm(t.name), (t) => t.name).slice(0, 5);
    const where = group((t) => t.card_id ?? t.account_id, (t) => t.card_name ?? t.account_name ?? "Conta");
    const total = paid + upcoming;
    const fixed = thisMonth.filter((t) => t.fixed || t.installment).reduce((s, t) => s + amount(t), 0);
    const biggest = [...thisMonth].sort((a, b) => amount(b) - amount(a))[0];
    return { bars, thisMonth, paid, upcoming, total, average, top, where, fixed, biggest, peak: Math.max(1, ...bars.map((b) => b.total)) };
  }, [txs.data, month, categoryId]);

  const limit = row?.budget ?? category?.monthly_budget ?? 0;
  const spent = row ? row.spent : data.paid;
  const used = limit > 0 ? spent / limit : 0;
  const projected = limit > 0 ? (spent + data.upcoming) / limit : 0;
  const isCurrent = month === todayISO().slice(0, 7);
  const daysLeft = Math.max(1, lastDay(month) - Number(todayISO().slice(8, 10)) + 1);
  const color = category?.color ?? "#8b5cf6";
  const isIncome = data.thisMonth.length > 0 && data.thisMonth.every((t) => t.type === "receita");
  const vsAverage = data.average > 0 ? (data.total - data.average) / data.average : null;
  const share = monthExpense && monthExpense > 0 && !isIncome ? data.paid / monthExpense : null;
  const card = "rounded-[24px] border border-border/70 bg-card p-4";
  const label = "text-xs font-semibold tracking-[1.5px] text-muted-foreground";

  if (txs.isPending) return <div className={card + " h-40 animate-pulse"} aria-label="Carregando análise da categoria" />;

  return (
    <div className="space-y-3" data-testid="category-insight">
      <section className={card} data-testid="category-insight-month">
        <div className="flex items-start justify-between gap-3">
          <p className={label}>{isCurrent ? "ESTE MÊS" : monthLabel(month).toUpperCase()}</p>
          {category ? <button type="button" onClick={() => dialogs.openCategory({ category })} aria-label={`Editar ${category.name}`} className="-m-1 grid size-9 shrink-0 place-items-center rounded-full text-[#a78bfa] hover:bg-muted"><Pencil size={15} /></button> : null}
        </div>
        <p className="mt-1 text-[34px] font-bold tabular-nums" style={{ color: isIncome ? "#34d399" : "#fb7185" }}>{money(data.total)}</p>
        <p className="text-sm text-muted-foreground">{money(data.paid)} {isIncome ? "recebido" : "já saiu"}{data.upcoming > 0 ? ` · ${money(data.upcoming)} ${isIncome ? "a receber" : "ainda vai sair"}` : ""}</p>
        {vsAverage != null || share != null ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {vsAverage != null && Math.abs(vsAverage) >= 0.01 ? (
              <span className={"inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold " + ((vsAverage > 0) !== isIncome ? "bg-[#fb7185]/15 text-[#fb7185]" : "bg-[#34d399]/15 text-[#34d399]")} data-testid="category-insight-vs-average">
                {vsAverage > 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{Math.round(Math.abs(vsAverage) * 100)}% {vsAverage > 0 ? "acima" : "abaixo"} da média
              </span>
            ) : null}
            {share != null && share > 0 && share < 0.995 ? <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground" data-testid="category-insight-share">{Math.round(share * 100)}% das suas despesas</span> : null}
          </div>
        ) : null}
        {limit > 0 ? (
          <div className="mt-3">
            {/* Paid in solid, still to come striped after it. */}
            <div className="flex h-2 overflow-hidden rounded-full bg-muted">
              <motion.div className="h-full" initial={{ width: 0 }} animate={{ width: `${Math.min(100, used * 100)}%` }} style={{ backgroundColor: projected > 1 ? "#fb7185" : projected > 0.8 ? "#fbbf24" : "#34d399" }} />
              <motion.div className="h-full opacity-50" initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, projected * 100) - Math.min(100, used * 100))}%` }} style={{ backgroundImage: "repeating-linear-gradient(45deg,#fbbf24 0 4px,transparent 4px 8px)" }} />
            </div>
            <p className={"mt-1.5 text-sm " + (projected > 1 ? "font-semibold text-[#fb7185]" : "text-muted-foreground")}>
              {projected > 1
                ? `${data.upcoming > 0 ? "Com o que está agendado, passa" : "Passou"} ${money(spent + data.upcoming - limit)} do limite de ${money(limit)}`
                : `${Math.round(projected * 100)}% do limite de ${money(limit)}${data.upcoming > 0 ? " contando os agendados" : ""} · sobram ${money(limit - spent - data.upcoming)}${isCurrent ? ` (${money((limit - spent - data.upcoming) / daysLeft)}/dia)` : ""}`}
            </p>
          </div>
        ) : isIncome ? null : <p className="mt-2 text-sm text-muted-foreground">Sem limite definido. <button type="button" className="font-semibold text-[#a78bfa]" onClick={() => category && dialogs.openCategory({ category })}>Definir limite</button></p>}
      </section>

      <section className={card} data-testid="category-insight-months">
        <p className={label}>ÚLTIMOS 6 MESES</p>
        <div className="mt-3 flex h-28 items-end gap-2" aria-label={`Média de ${money(data.average)} por mês`}>
          {data.bars.map((b, i) => {
            const selected = b.month === month;
            return (
              <button key={b.month} type="button" disabled={!onPickMonth || selected} onClick={() => onPickMonth?.(b.month)} aria-label={`${monthLabel(b.month)}: ${money(b.total)}`} aria-pressed={selected}
                className="flex flex-1 flex-col items-center gap-1 disabled:cursor-default" data-testid={`category-insight-bar-${b.month}`}>
                <span className="text-[10px] tabular-nums text-muted-foreground">{b.total > 0 && !hidden ? Math.round(b.total) : ""}</span>
                <motion.span className="block w-full rounded-lg" initial={{ height: 0 }} animate={{ height: `${Math.max(4, (b.total / data.peak) * 80)}px` }} transition={{ delay: i * 0.05 }}
                  style={{ backgroundColor: selected ? color : "#2f3060" }} />
                <span className={"text-[11px] " + (selected ? "font-semibold text-foreground" : "text-muted-foreground")}>{monthLabel(b.month).slice(0, 3)}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{data.average > 0 ? <>Média de <span className="font-semibold text-foreground">{money(data.average)}</span> nos meses anteriores.</> : "Sem histórico nos meses anteriores."}</p>
      </section>

      {data.top.length ? (
        <section className={card} data-testid="category-insight-top">
          <p className={label}>PARA ONDE FOI</p>
          <ul className="mt-2 space-y-1">
            {data.top.map((t) => (
              <li key={t.name}>
                <button type="button" disabled={!onPickName} onClick={() => onPickName?.(t.name)} className="-mx-2 block w-[calc(100%+1rem)] rounded-xl px-2 py-1.5 text-left hover:bg-muted/50 disabled:hover:bg-transparent" aria-label={`Ver lançamentos de ${t.name}`}>
                  <div className="flex items-center justify-between gap-2 text-sm"><span className="truncate font-medium">{t.name} <span className="text-muted-foreground">· {t.count}×</span></span><span className="shrink-0 font-semibold tabular-nums">{money(t.total)}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(t.total / data.top[0].total) * 100}%`, backgroundColor: color }} /></div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.thisMonth.length ? (
        <section className={card} data-testid="category-insight-summary">
          <p className={label}>RESUMO</p>
          <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Lançamentos</dt><dd className="font-semibold tabular-nums">{data.thisMonth.length}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Valor médio</dt><dd className="font-semibold tabular-nums">{money(data.total / data.thisMonth.length)}</dd></div>
            {data.biggest ? <div className="col-span-2"><dt className="text-xs text-muted-foreground">Maior lançamento</dt><dd className="truncate font-semibold">{data.biggest.name} · <span className="tabular-nums">{money(amount(data.biggest))}</span></dd></div> : null}
            {data.total > 0 ? <div className="col-span-2"><dt className="text-xs text-muted-foreground">Fixo ou parcelado</dt><dd className="font-semibold tabular-nums">{money(data.fixed)} <span className="font-normal text-muted-foreground">· {Math.round((data.fixed / data.total) * 100)}% · o resto varia</span></dd></div> : null}
          </dl>
          {data.where.length > 1 ? (
            <>
              <p className="mt-4 text-xs text-muted-foreground">Onde foi pago</p>
              <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-muted">
                {data.where.map((w, i) => <span key={w.name} className="h-full" style={{ width: `${(w.total / data.total) * 100}%`, backgroundColor: color, opacity: 1 - i * 0.22 }} />)}
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {data.where.map((w, i) => <li key={w.name} className="flex items-center gap-2"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color, opacity: 1 - i * 0.22 }} /><span className="min-w-0 flex-1 truncate">{w.name}</span><span className="tabular-nums text-muted-foreground">{money(w.total)}</span></li>)}
              </ul>
            </>
          ) : data.where[0] ? <p className="mt-3 text-xs text-muted-foreground">Tudo pago com {data.where[0].name}.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
