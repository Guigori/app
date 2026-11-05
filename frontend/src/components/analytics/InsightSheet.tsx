import { Link } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { isThisMonth, pinIndex } from "@/lib/chartPin";
import { ArrowRight } from "lucide-react";
import type { MonthTrend } from "@/types/finnos";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface InsightDetail {
  title: string;
  value: string;
  /** Plain-language "what this means and how it is calculated". */
  explain: string;
  chart?: "income-expense" | "expense" | "net";
  items?: Array<{ label: string; value: string; tone?: "income" | "expense" }>;
  cta?: { label: string; to: string };
}

const money = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
const tooltip = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--popover-foreground)", fontSize: 13 };

/** Tapping an analysis card explains it in place: the number, what it means, its trend and where to act. */
export function InsightSheet({ detail, trend, hidden, onClose }: { detail: InsightDetail | null; trend: MonthTrend[]; hidden: boolean; onClose: () => void }) {
  return (
    <Dialog open={detail !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md" data-testid="insight-sheet">
        {detail ? <>
          <DialogHeader>
            <DialogTitle className="font-heading">{detail.title}</DialogTitle>
            <DialogDescription className="sr-only">{detail.explain}</DialogDescription>
          </DialogHeader>
          <p className="font-heading text-3xl font-bold tabular-nums">{detail.value}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{detail.explain}</p>
          {detail.chart && trend.length > 1 && !hidden ? (
            <div className="h-40 w-full" aria-label="Últimos meses">
              <ResponsiveContainer width="100%" height="100%">
                {detail.chart === "net" ? (
                  <AreaChart data={trend} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
                    <Tooltip active defaultIndex={pinIndex(trend, (m) => isThisMonth(m))} contentStyle={tooltip} formatter={(v: number) => [money(v), "Resultado"]} />
                    <Area type="monotone" dataKey="net" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.12} strokeWidth={2} />
                  </AreaChart>
                ) : (
                  <BarChart data={trend} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
                    <Tooltip active defaultIndex={pinIndex(trend, (m) => isThisMonth(m))} contentStyle={tooltip} cursor={{ fill: "var(--muted)" }} formatter={(v: number, name: string) => [money(v), name === "income" ? "Receitas" : "Despesas"]} />
                    {detail.chart === "income-expense" ? <Bar dataKey="income" fill="var(--income)" radius={[5, 5, 0, 0]} maxBarSize={18} /> : null}
                    <Bar dataKey="expense" fill="var(--expense)" radius={[5, 5, 0, 0]} maxBarSize={18} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          ) : null}
          {detail.items?.length ? (
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {detail.items.map((item) => (
                <li key={item.label} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 truncate">{item.label}</span>
                  <span className={"shrink-0 font-semibold tabular-nums " + (item.tone === "income" ? "text-income" : item.tone === "expense" ? "text-expense" : "")}>{item.value}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {detail.cta ? (
            <Link to={detail.cta.to} onClick={onClose} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-primary-foreground">
              {detail.cta.label}<ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
        </> : null}
      </DialogContent>
    </Dialog>
  );
}
