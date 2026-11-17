/**
 * Blocos do início do Orçamento que seguem a tela 1 do protótipo aprovado: para onde vai o que entrou (rosca), saldo até
 * o fim do mês (linha real + estimativa), ritmo do dia a dia (gauge + mapa de calor) e contas a pagar / a receber.
 * Tudo é lido do MonthView; tocar num item abre o registro onde ele vive.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { MonthView, PlanItem } from "@/lib/budget/monthView";
import { Donut, FINNOS_COLOR, Gauge, Heatmap, ProjectionLine } from "@/components/charts/FinnosCharts";
import { card } from "@/components/budget/shared";
import { cn } from "@/lib/utils";

type P = { v: MonthView; money: (n: number) => string };
/** Rótulo de seção dos cartões, como no protótipo aprovado. */
export const lbl = "text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const MON = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86400000);

/** Para onde vai o que entrou: o que já saiu, o que falta pagar, metas, reserva e o livre. */
export function DistributionCard({ v, money }: P) {
  const [sel, setSel] = useState<string | null>(null);
  const past = v.when === "past";
  const left = past ? Math.max(0, v.earned - v.spent) : Math.max(0, v.free);
  const slices = [
    { id: "saiu", name: "Já saiu", value: v.spent, color: FINNOS_COLOR.result, note: "gastos e contas pagas" },
    { id: "pagar", name: "Falta pagar", value: past ? 0 : v.toPay, color: "#F59E0B", note: "contas, faturas e agendados" },
    { id: "metas", name: "Metas", value: past ? 0 : v.goalsReserve, color: "#B3A6FF", note: "planejado para guardar" },
    { id: "reserva", name: "Reserva", value: past ? 0 : v.cushion, color: "#9CA3AF", note: "para imprevistos" },
    { id: "livre", name: past ? "Sobrou" : "Livre", value: left, color: FINNOS_COLOR.income, note: past ? "ficou nas contas" : "para o dia a dia" },
  ].filter((s) => s.value > 0.005);
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (!total) return null;
  return (
    <section aria-label="Distribuição do mês" className={card} data-testid="budget-distribution">
      <div className="flex items-baseline justify-between gap-3">
        <p className={lbl}>{past ? "Para onde foi o dinheiro" : v.when === "future" ? "Para onde vai o que vou ter" : "Para onde vai o dinheiro"}</p>
        <strong className="font-heading text-base tabular-nums text-income">{money(total)}</strong>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">O que já saiu no mês e o que está nas contas{v.earned ? <>; entraram <strong className="tabular-nums text-income">{money(v.earned)}</strong></> : null}.</p>
      <div className="mt-3 flex justify-center"><Donut slices={slices} size={176} selectedId={sel} onSelect={setSel} format={money} centerLabel="Total" /></div>
      <ul className="mt-2">
        {slices.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => setSel(sel === s.id ? null : s.id)} className={cn("flex w-full items-center gap-3 border-b border-border/60 py-2.5 text-left last:border-0", sel && sel !== s.id && "opacity-40")}>
              <span className="h-3 w-3 shrink-0 rounded" style={{ background: s.color }} />
              <span className="min-w-0 flex-1"><strong className="block text-sm">{s.name}</strong><span className="text-xs text-muted-foreground">{s.note}</span></span>
              <span className="text-right"><strong className="block text-sm tabular-nums">{money(s.value)}</strong><span className="text-[11px] text-muted-foreground">{Math.round((s.value / total) * 100)}%</span></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Saldo dia a dia (real cheio, estimativa tracejada) com entrou, já saiu e falta pagar. */
export function BalanceCard({ v, money }: P) {
  const pts = v.projection.map((p) => ({ value: p.value, kind: p.kind, label: dm(p.date) }));
  const unpaid = v.items.filter((i) => i.type === "despesa" && i.state !== "realizado");
  const open = unpaid.length, late = v.when === "current" ? unpaid.filter((i) => i.date < v.today).length : 0;
  return (
    <section aria-label="Saldo até o fim do mês" className={card} data-testid="budget-balance">
      <div className="flex items-baseline justify-between gap-3">
        <p className={lbl}>Saldo até o fim do mês</p>
        <span className="text-right text-xs text-muted-foreground">{v.when === "past" ? "mês fechado" : <>{v.when === "future" ? "previsão" : "estimativa"} em {v.daysInMonth}/{v.month.slice(5)}: <strong className="tabular-nums text-foreground">{money(v.endBalance)}</strong></>}</span>
      </div>
      {pts.length > 1 ? <ProjectionLine className="mt-3" points={pts} area format={money} ariaLabel={`Saldo dia a dia; estimativa de ${money(v.endBalance)} no fim do mês`} /> : null}
      {v.lowest && v.when !== "past" && v.lowest.value < v.endBalance ? <p className={cn("mt-2 text-xs", v.lowest.value < 0 ? "font-semibold text-expense" : "text-muted-foreground")}>Ponto mais baixo: {money(v.lowest.value)} em {dm(v.lowest.date)}.</p> : null}
      <div className="mt-3 grid gap-2 text-[13px]">
        <span className="flex justify-between"><span className="text-muted-foreground">{v.when === "future" ? "Vou ganhar" : "Ganhei"}</span><span><strong className="tabular-nums text-income">{money(v.earned)}</strong>{v.toReceive > 0 ? <span className="text-muted-foreground"> + {money(v.toReceive)} a receber</span> : null}</span></span>
        <span className="flex justify-between"><span className="text-muted-foreground">Já saiu</span><strong className="tabular-nums">{money(v.spent)}</strong></span>
        <span className="flex justify-between"><span className="text-muted-foreground">Falta pagar</span><strong className={cn("tabular-nums", v.toPay > 0 && "text-expense")}>{money(v.toPay)}</strong></span>
      </div>
      <Link to={`/orcamento/compromissos?mes=${v.month}`} className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-[13px] font-semibold text-primary">
        <span>Comprometido {money(v.toPay + v.goalsReserve)} · <span className={late ? "text-expense" : undefined}>{late ? `${late} ${late === 1 ? "vencida" : "vencidas"}` : v.toPay ? `${open} ${open === 1 ? "conta" : "contas"}` : "tudo pago"}</span></span><ChevronRight className="h-4 w-4" />
      </Link>
    </section>
  );
}

/** Orçamento do dia a dia: quanto dos limites já foi usado contra quanto do mês passou, e o gasto de cada dia. */
export function PaceCard({ v, money }: P) {
  const d = v.daily;
  if (v.when === "future" || !d.limit) return null;
  const ahead = v.when === "current" && d.percent > d.elapsed + 0.05;
  const tag = d.spent > d.limit ? "passou do limite" : v.when === "past" ? "dentro do limite" : ahead ? "um pouco acima" : "no ritmo";
  const tone = d.spent > d.limit ? "text-expense" : ahead ? "text-amber-700 dark:text-amber-400" : "text-income";
  const heavy = Object.entries(v.heat).sort((a, b) => b[1] - a[1])[0];
  const passed = Math.max(1, v.daysInMonth - v.daysLeft + 1);
  const planToday = d.limit * d.elapsed, avg = d.spent / passed, closesAt = avg * v.daysInMonth;
  const paceText = v.when === "current"
    ? <>Gastou <strong className="tabular-nums">{money(d.spent)}</strong> em {passed} {passed === 1 ? "dia" : "dias"}. O plano até hoje era <strong className="tabular-nums">{money(planToday)}</strong>. Mantendo {money(avg)} por dia, fecha em <strong className="tabular-nums">{money(closesAt)}</strong>{d.spent > d.limit ? "; os limites do mês já passaram." : <>; para ficar no limite, são até <strong className="tabular-nums">{money(d.allowance)} por dia</strong>.</>}</>
    : <>Gastou <strong className="tabular-nums">{money(d.spent)}</strong> de <strong className="tabular-nums">{money(d.limit)}</strong>{d.spent > d.limit ? `: ${money(d.spent - d.limit)} acima do plano.` : `: sobraram ${money(d.limit - d.spent)}.`}</>;
  return (
    <section aria-label="Ritmo do dia a dia" className={card} data-testid="budget-pace">
      <div className="flex items-baseline justify-between gap-2"><p className={lbl}>Orçamento do dia a dia</p><span className={cn("text-xs font-semibold", tone)}>{tag}</span></div>
      <Gauge className="mt-3" percent={d.percent} size={200} detail={<>{money(d.spent)}<br />de {money(d.limit)} · sobram {money(Math.max(0, d.limit - d.spent))}</>}>
        <strong className="block font-heading text-2xl tabular-nums">{Math.round(d.percent * 100)}%</strong>
        <span className="text-[11px] text-muted-foreground">{v.when === "current" ? `do plano · ${Math.round(d.elapsed * 100)}% do mês` : "do plano"}</span>
      </Gauge>
      <p className="mt-2 text-[13px] leading-relaxed">{paceText}</p>
      {Object.keys(v.heat).length ? (
        <>
          <p className="mb-1.5 mt-4 text-xs font-semibold">Gasto por dia</p>
          <Heatmap month={v.month} values={v.heat} today={v.today} format={money} />
          {heavy ? <p className="mt-2 text-xs text-muted-foreground">Toque num dia. O mais pesado foi {dm(heavy[0])}, com {money(heavy[1])}.</p> : null}
        </>
      ) : null}
    </section>
  );
}

function linkOf(i: PlanItem, month: string) {
  if (i.transaction_id) return `/transacoes?month=${i.date.slice(0, 7) || month}&highlight=${i.transaction_id}`;
  if (i.card_id) return `/cartoes/${i.card_id}`;
  if (i.subscription_id) return `/assinaturas?assinatura=${i.subscription_id}`;
  return `/orcamento/compromissos?mes=${month}`;
}

function ItemRow({ i, v, money }: { i: PlanItem & { review?: boolean }; v: MonthView; money: (n: number) => string }) {
  const navigate = useNavigate();
  const done = i.state === "realizado";
  const inc = i.type === "receita";
  const d = days(v.today, i.date);
  const late = !done && v.when !== "future" && d < 0;
  let sub: string;
  if (i.review) sub = "Repetida · decida em Compromissos";
  else if (done) sub = `${inc ? "Recebido" : "Pago"} em ${dm(i.date)}`;
  else if (v.when !== "current") sub = i.state === "estimativa" ? "Estimativa" : "Agendado";
  else sub = `${i.state === "estimativa" ? "Estimativa" : "Agendado"} · ${d < 0 ? `${inc ? "Atrasado" : "Venceu"} há ${-d} ${d === -1 ? "dia" : "dias"}` : d === 0 ? (inc ? "Cai hoje" : "Vence hoje") : `${inc ? "Cai" : "Vence"} em ${d} ${d === 1 ? "dia" : "dias"}`}`;
  const soon = !done && !late && v.when === "current" && d >= 0 && d <= 3;
  return (
    <li>
      <button type="button" onClick={() => navigate(i.review ? `/orcamento/compromissos?mes=${v.month}` : linkOf(i, v.month))} className="flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left last:border-0 hover:bg-muted/40">
        <span className={cn("grid h-12 w-11 shrink-0 place-content-center rounded-xl text-center", late ? "bg-expense/10 text-expense" : "bg-primary/[0.07]", done && "text-muted-foreground")}>
          <strong className="font-heading text-base leading-none">{i.date.slice(8)}</strong>
          <span className="mt-1 text-[10px] font-bold tracking-wide">{MON[Number(i.date.slice(5, 7)) - 1]}</span>
        </span>
        <span className="min-w-0 flex-1">
          <strong className={cn("block truncate text-sm", i.review && "text-muted-foreground")}>{i.name}</strong>
          <span className={cn("text-xs", late ? "text-expense" : soon ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{sub}</span>
        </span>
        <strong className={cn("text-sm tabular-nums", inc && "text-income", i.review && "text-muted-foreground")}>{money(i.value)}</strong>
        <span aria-hidden="true" className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", done ? "bg-income text-white" : cn("border-2", i.state === "estimativa" || i.review ? "border-dashed border-muted-foreground/60" : late ? "border-expense" : "border-border"))}>
          {done ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg> : null}
        </span>
      </button>
    </li>
  );
}

/** Contas a pagar e a receber do mês, na ordem das datas; as repetidas ainda não aprovadas aparecem esmaecidas. */
export function BillsCard({ v, money, kind, max = 6 }: P & { kind: "despesa" | "receita"; max?: number }) {
  const [all, setAll] = useState(false);
  const inc = kind === "receita";
  const list = [
    ...v.items.filter((i) => i.type === kind),
    ...v.suggestions.filter((i) => i.type === kind).map((i) => ({ ...i, review: true })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  // Open first (late on top), then what is already done.
  const open = list.filter((i) => i.state !== "realizado"), done = list.filter((i) => i.state === "realizado");
  const ordered = [...open, ...done];
  const pending = open.filter((i) => !("review" in i)).reduce((s, i) => s + i.value, 0);
  if (!ordered.length) return null;
  const shown = all ? ordered : ordered.slice(0, max);
  return (
    <section aria-label={inc ? "A receber" : "Contas a pagar"} className="min-w-0" data-testid={inc ? "budget-incomes" : "budget-bills"}>
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h2 className="font-heading text-[17px] font-bold">{inc ? "A receber" : "Contas a pagar"}</h2>
        {inc ? <span className="text-xs text-muted-foreground">{pending ? `${money(pending)} ainda vão entrar` : "nada pendente"}</span>
          : <Link to={`/orcamento/compromissos?mes=${v.month}`} className="text-xs font-semibold text-primary">{pending ? `falta ${money(pending)}` : "tudo pago"} · ver tudo</Link>}
      </div>
      <ul className="overflow-hidden rounded-[20px] border border-border bg-card">{shown.map((i) => <ItemRow key={`${i.key}${"review" in i ? ":r" : ""}`} i={i} v={v} money={money} />)}</ul>
      {ordered.length > max ? <button type="button" onClick={() => setAll((a) => !a)} className="mt-2 text-[13px] font-semibold text-primary">{all ? "Mostrar menos" : `Ver mais ${ordered.length - max}`}</button> : null}
      {!inc ? (
        <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 px-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-income" />realizado: saiu ou entrou na conta</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-border" />agendado</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-dashed border-muted-foreground/60" />{list.some((i) => "review" in i) ? "estimativa ou repetida" : "estimativa"}</span>
        </div>
      ) : null}
    </section>
  );
}
