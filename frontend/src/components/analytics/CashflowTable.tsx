import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MonthTrend } from "@/types/finnos";

/** "O que cada mês faz com o caixa": saiu | barras divergentes | entrou | líquido. */
export function CashflowTable({ months, currentMonth }: { months: MonthTrend[]; currentMonth: string }) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.income, m.expense)));
  const totalIncome = months.reduce((s, m) => s + m.income, 0);
  const totalExpense = months.reduce((s, m) => s + m.expense, 0);

  return (
    <div data-testid="cashflow-table">
      <table className="w-full text-sm">
        <caption className="sr-only">Entradas, saídas e líquido por mês</caption>
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th scope="col" className="pb-2 text-left font-normal">mês</th>
            <th scope="col" className="pb-2 text-right font-normal">saiu</th>
            <th scope="col" className="pb-2 text-center font-normal" />
            <th scope="col" className="pb-2 text-right font-normal">entrou</th>
            <th scope="col" className="pb-2 text-right font-normal">líquido</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => {
            const isCurrent = m.month === currentMonth;
            return (
              <tr
                key={m.month}
                className={cn("align-middle", isCurrent && "bg-muted/60")}
                data-testid={`cashflow-row-${m.month}`}
              >
                <td className={cn("py-1.5 pl-2 text-muted-foreground", isCurrent && "font-semibold text-foreground")}>
                  {m.label}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                  {Math.round(m.expense).toLocaleString("pt-BR")}
                </td>
                <td className="w-[38%] py-1.5">
                  <div className="flex items-center" aria-hidden="true">
                    <div className="flex h-3.5 flex-1 justify-end">
                      <div className="h-full rounded-l-sm bg-expense/80" style={{ width: `${(m.expense / max) * 100}%` }} />
                    </div>
                    <div className="h-4 w-px bg-border" />
                    <div className="flex h-3.5 flex-1">
                      <div className="h-full rounded-r-sm bg-income/80" style={{ width: `${(m.income / max) * 100}%` }} />
                    </div>
                  </div>
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-muted-foreground">
                  {Math.round(m.income).toLocaleString("pt-BR")}
                </td>
                <td
                  className={cn(
                    "py-1.5 pl-3 pr-2 text-right font-semibold tabular-nums",
                    m.net >= 0 ? "text-income" : "text-expense",
                  )}
                >
                  {m.net >= 0 ? "+" : "−"}
                  {Math.abs(Math.round(m.net)).toLocaleString("pt-BR")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
        <span className="text-muted-foreground">
          Entrou <strong className="font-heading text-income">{formatBRL(totalIncome)}</strong>
        </span>
        <span className="text-muted-foreground">
          Saiu <strong className="font-heading text-expense">{formatBRL(totalExpense)}</strong>
        </span>
      </div>
    </div>
  );
}
