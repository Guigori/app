import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ChevronRight, Pencil } from "lucide-react";
import { fetchBudget, fetchCategories, fetchTransactions } from "@/lib/data";
import { addMonth, formatBRL, formatHiddenBRL, monthLabel, todayISO } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import type { Transaction } from "@/types/finnos";

const GROUP = { necessidades: "Necessidades", desejos: "Desejos", metas: "Metas e investimentos" } as const;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim();
const lastDay = (month: string) => { const [y, m] = month.split("-").map(Number); return new Date(y, m, 0).getDate(); };

/** One category on its own: this month against its limit, the last six months, where the money went, and every lançamento. */
export default function CategoryDetail() {
  const { categoryId = "" } = useParams();
  const dialogs = useDialogs();
  const { hidden } = useBalanceHidden();
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const month = todayISO().slice(0, 7);
  const first = addMonth(month, -5);
  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const category = categories.data?.find((c) => c.id === categoryId);
  const txs = useQuery({
    queryKey: ["transactions", "category-detail", categoryId, month],
    queryFn: () => fetchTransactions({ category_id: categoryId, start_date: `${first}-01`, end_date: `${month}-${lastDay(month)}` }),
    enabled: Boolean(categoryId),
  });
  const budget = useQuery({ queryKey: ["budget", month], queryFn: () => fetchBudget(month) });
  const row = budget.data?.rows.find((r) => r.category_id === categoryId);

  const data = useMemo(() => {
    const rows = (txs.data ?? []).filter((t) => t.type !== "transferencia");
    const months = Array.from({ length: 6 }, (_, i) => addMonth(month, i - 5));
    const sign = (t: Transaction) => t.value;
    const bars = months.map((m) => ({ month: m, total: rows.filter((t) => t.date.slice(0, 7) === m).reduce((s, t) => s + sign(t), 0) }));
    const thisMonth = rows.filter((t) => t.date.slice(0, 7) === month).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
    const paid = thisMonth.filter((t) => t.status === "pago").reduce((s, t) => s + t.value, 0);
    const upcoming = thisMonth.filter((t) => t.status !== "pago").reduce((s, t) => s + t.value, 0);
    const previous = bars.slice(0, -1).filter((b) => b.total > 0);
    const average = previous.length ? previous.reduce((s, b) => s + b.total, 0) / previous.length : 0;
    const byName = new Map<string, { name: string; total: number; count: number }>();
    for (const t of rows.filter((r) => r.date.slice(0, 7) === month)) {
      const k = norm(t.name); const e = byName.get(k) ?? { name: t.name, total: 0, count: 0 }; e.total += t.value; e.count += 1; byName.set(k, e);
    }
    const top = [...byName.values()].sort((a, b) => b.total - a.total).slice(0, 5);
    return { bars, thisMonth, paid, upcoming, average, top, peak: Math.max(1, ...bars.map((b) => b.total)) };
  }, [txs.data, month]);

  const limit = row?.budget ?? category?.monthly_budget ?? 0;
  const spent = row ? row.spent : data.paid;
  const used = limit > 0 ? spent / limit : 0;
  const projected = limit > 0 ? (spent + data.upcoming) / limit : 0;
  const daysLeft = Math.max(1, lastDay(month) - Number(todayISO().slice(8, 10)) + 1);
  const color = category?.color ?? "#8b5cf6";
  const isIncome = data.thisMonth.some((t) => t.type === "receita") && !data.thisMonth.some((t) => t.type === "despesa");

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 px-4 pb-32 pt-4" data-testid="category-detail">
      <header className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-full" style={{ backgroundColor: `color-mix(in oklab, ${color} 18%, transparent)`, color }}>
          <CategoryIcon name={category?.icon ?? "more-horizontal"} className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[22px] font-bold" style={{ color: `color-mix(in oklab, ${color} 75%, white)` }}>{category?.name ?? (categories.isPending ? "Carregando…" : "Categoria")}</h1>
          <p className="text-xs text-muted-foreground">{category ? GROUP[category.group] : ""} · {monthLabel(month)}</p>
        </div>
        {category ? <button type="button" onClick={() => dialogs.openCategory({ category })} aria-label="Editar categoria" className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card text-[#a78bfa]"><Pencil size={17} /></button> : null}
      </header>

      <section className="rounded-[24px] border border-border/70 bg-card p-4" data-testid="category-detail-month">
        <p className="text-xs font-semibold tracking-[1.5px] text-muted-foreground">ESTE MÊS</p>
        <p className="mt-1 text-[34px] font-bold tabular-nums" style={{ color: isIncome ? "#34d399" : "#fb7185" }}>{money(data.paid + data.upcoming)}</p>
        <p className="text-sm text-muted-foreground">{money(data.paid)} {isIncome ? "recebido" : "já saiu"}{data.upcoming > 0 ? ` · ${money(data.upcoming)} ${isIncome ? "a receber" : "ainda vai sair"}` : ""}</p>
        {limit > 0 ? (
          <div className="mt-3">
            {/* Paid in solid, still to come striped after it. */}
            <div className="flex h-2 overflow-hidden rounded-full bg-muted">
              <motion.div className="h-full" initial={{ width: 0 }} animate={{ width: `${Math.min(100, used * 100)}%` }} style={{ backgroundColor: projected > 1 ? "#fb7185" : projected > 0.8 ? "#fbbf24" : "#34d399" }} />
              <motion.div className="h-full opacity-50" initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, projected * 100) - Math.min(100, used * 100))}%` }} style={{ backgroundImage: "repeating-linear-gradient(45deg,#fbbf24 0 4px,transparent 4px 8px)" }} />
            </div>
            <p className={"mt-1.5 text-sm " + (projected > 1 ? "font-semibold text-[#fb7185]" : "text-muted-foreground")}>
              {projected > 1 ? `Com o que está agendado, passa ${money(spent + data.upcoming - limit)} do limite de ${money(limit)}` : `${Math.round(projected * 100)}% do limite de ${money(limit)}${data.upcoming > 0 ? " contando os agendados" : ""} · sobram ${money(limit - spent - data.upcoming)} (${money((limit - spent - data.upcoming) / daysLeft)}/dia)`}
            </p>
          </div>
        ) : <p className="mt-2 text-sm text-muted-foreground">Sem limite definido. <button type="button" className="font-semibold text-[#a78bfa]" onClick={() => category && dialogs.openCategory({ category })}>Definir limite</button></p>}
      </section>

      <section className="rounded-[24px] border border-border/70 bg-card p-4" data-testid="category-detail-months">
        <p className="text-xs font-semibold tracking-[1.5px] text-muted-foreground">ÚLTIMOS 6 MESES</p>
        <div className="mt-3 flex h-28 items-end gap-2" aria-label={`Média de ${money(data.average)} por mês`}>
          {data.bars.map((b, i) => (
            <div key={b.month} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] tabular-nums text-muted-foreground">{b.total > 0 && !hidden ? Math.round(b.total) : ""}</span>
              <motion.div className="w-full rounded-lg" initial={{ height: 0 }} animate={{ height: `${Math.max(4, (b.total / data.peak) * 80)}px` }} transition={{ delay: i * 0.05 }}
                style={{ backgroundColor: i === data.bars.length - 1 ? color : "#2f3060" }} />
              <span className="text-[11px] text-muted-foreground">{monthLabel(b.month).slice(0, 3)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{data.average > 0 ? <>Média de <span className="font-semibold text-foreground">{money(data.average)}</span> nos meses anteriores.</> : "Sem histórico nos meses anteriores."}</p>
      </section>

      {data.top.length ? (
        <section className="rounded-[24px] border border-border/70 bg-card p-4" data-testid="category-detail-top">
          <p className="text-xs font-semibold tracking-[1.5px] text-muted-foreground">PARA ONDE FOI</p>
          <ul className="mt-2 space-y-2.5">
            {data.top.map((t) => (
              <li key={t.name}>
                <div className="flex items-center justify-between text-sm"><span className="truncate font-medium">{t.name} <span className="text-muted-foreground">· {t.count}×</span></span><span className="font-semibold tabular-nums">{money(t.total)}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(t.total / data.top[0].total) * 100}%`, backgroundColor: color }} /></div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-[24px] border border-border/70 bg-card px-4 pb-2 pt-4" data-testid="category-detail-list">
        <p className="text-xs font-semibold tracking-[1.5px] text-muted-foreground">LANÇAMENTOS DO MÊS</p>
        {data.thisMonth.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{txs.isPending ? "Carregando…" : "Nada neste mês."}</p> : (
          <ul className="mt-1 divide-y divide-dashed divide-border">
            {data.thisMonth.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => dialogs.openTransactionDetail(t, data.thisMonth)} className="flex w-full items-center gap-3 py-3 text-left">
                  <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{t.name}</span><span className="block text-xs text-muted-foreground">{t.date.split("-").reverse().slice(0, 2).join("/")} · {t.card_name ?? t.account_name}{t.status !== "pago" ? " · agendado" : ""}</span></span>
                  <span className="shrink-0 font-semibold tabular-nums" style={{ color: t.type === "receita" ? "#34d399" : undefined }}>{money(t.value)}</span>
                  <ChevronRight size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {/* The other screens about this category, one tap away. */}
      <nav className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Mais sobre esta categoria">
        {[
          [`/transacoes?month=${month}&category_id=${encodeURIComponent(categoryId)}`, "Todos os lançamentos", "Fluxo filtrado"],
          ["/orcamento", "Orçamento", "Limites do ciclo"],
          [`/analise/categorias?month=${month}`, "Análise de categorias", "Comparar com as outras"],
        ].map(([to, title, hint]) => (
          <Link key={to} to={to} className="flex h-14 items-center justify-between rounded-full border border-border bg-card px-5">
            <span className="min-w-0"><span className="block text-[15px] font-semibold">{title}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
            <ChevronRight size={17} className="shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </nav>
    </div>
  );
}
