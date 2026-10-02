import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, PieChart, Settings2, XCircle, type LucideIcon } from "lucide-react";
import { fetchBudget } from "@/lib/data";
import { formatBRL, monthLabel, GROUP_LABEL } from "@/lib/format";
import { currentMonth } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BudgetRow, BudgetStatus } from "@/types/finnos";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { MonthSelector } from "@/components/dashboard/MonthSelector";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_META: Record<BudgetStatus, { label: string; icon: LucideIcon; bar: string; text: string }> = {
  sem_limite: { label: "Sem limite definido", icon: Info, bar: "bg-muted-foreground/40", text: "text-muted-foreground" },
  dentro: { label: "Uso normal", icon: CheckCircle2, bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  proximo: { label: "Próximo do limite", icon: AlertTriangle, bar: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  acima: { label: "Limite ultrapassado", icon: XCircle, bar: "bg-rose-500", text: "text-rose-700 dark:text-rose-400" },
};

function BudgetRowItem({ row, onEdit }: { row: BudgetRow; onEdit: () => void }) {
  const meta = STATUS_META[row.status];
  const StatusIcon = meta.icon;
  const hasBudget = row.budget > 0;

  return (
    <li className="flex items-center gap-3 py-3" data-testid={`budget-row-${row.category_id}`}>
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
        style={{ backgroundColor: row.color + "1A", color: row.color }}
        aria-hidden="true"
      >
        <CategoryIcon name={row.icon} className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="truncate font-medium text-foreground">{row.name}</p>
          <p className="shrink-0 font-heading text-sm font-bold tabular-nums text-foreground" data-testid={`budget-values-${row.category_id}`}>
            {formatBRL(row.spent)}
            {hasBudget ? <span className="font-normal text-muted-foreground"> / {formatBRL(row.budget)}</span> : null}
          </p>
        </div>

        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(row.percent)} aria-valuemin={0} aria-valuemax={100} aria-label={`${row.name}: ${meta.label}`}>
          <div
            className={cn("h-full rounded-full transition-all duration-500", meta.bar)}
            style={{ width: hasBudget ? `${Math.min(row.percent, 100)}%` : "18%" }}
          />
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className={cn("inline-flex items-center gap-1 font-medium", meta.text)} data-testid={`budget-status-${row.category_id}`}>
            <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {meta.label}
          </span>
          {hasBudget ? (
            <span className="tabular-nums text-muted-foreground">
              {Math.round(row.percent)}% ·{" "}
              {row.remaining >= 0 ? `faltam ${formatBRL(row.remaining)}` : `${formatBRL(-row.remaining)} acima`}
            </span>
          ) : null}
        </div>
      </div>

      <Button
        size="icon-sm"
        variant="ghost"
        onClick={onEdit}
        aria-label={`Definir orçamento de ${row.name}`}
        data-testid={`budget-edit-${row.category_id}`}
      >
        <Settings2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </li>
  );
}

export default function Budget() {
  const dialogs = useDialogs();
  const [month, setMonth] = useState(currentMonth());
  const budgetQuery = useQuery({ queryKey: ["budget", month], queryFn: () => fetchBudget(month) });
  const data = budgetQuery.data;

  const overallStatus: BudgetStatus = !data || data.planned === 0
    ? "sem_limite"
    : data.percent <= 80
      ? "dentro"
      : data.percent <= 100
        ? "proximo"
        : "acima";
  const overallMeta = STATUS_META[overallStatus];
  const OverallIcon = overallMeta.icon;

  const grouped = (["necessidades", "desejos", "metas"] as const).map((group) => ({
    group,
    rows: (data?.rows ?? []).filter((r) => r.group === group),
  }));

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Orçamento mensal</h1>
          <p className="mt-1 text-sm text-muted-foreground">Quanto você planejou e quanto já usou em cada categoria.</p>
        </div>
        <MonthSelector month={month} onChange={setMonth} />
      </div>

      {budgetQuery.isPending ? (
        <div className="h-64 animate-pulse rounded-3xl bg-muted" aria-hidden="true" />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState
          icon={<PieChart className="h-5 w-5" aria-hidden="true" />}
          title="Nenhum orçamento definido ainda"
          description="Defina um orçamento mensal nas suas categorias para acompanhar aqui quanto ainda pode gastar."
          action={
            <Button onClick={() => dialogs.openCategory()} data-testid="budget-empty-create-button">
              Definir orçamento em uma categoria
            </Button>
          }
        />
      ) : (
        <>
          <Card data-testid="budget-summary-card">
            <CardHeader className="pb-3">
              <CardTitle className="font-heading">Resumo de {monthLabel(month)}</CardTitle>
              <CardDescription>
                <span className={cn("inline-flex items-center gap-1 font-medium", overallMeta.text)}>
                  <OverallIcon className="h-4 w-4" aria-hidden="true" />
                  {data.planned === 0 ? "Nenhum limite definido" : overallMeta.label}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-2xl bg-muted/60 p-3">
                  <p className="text-xs text-muted-foreground">Planejado</p>
                  <p className="font-heading text-lg font-bold tabular-nums text-foreground" data-testid="budget-planned">
                    {formatBRL(data.planned)}
                  </p>
                </div>
                <div className="rounded-2xl bg-muted/60 p-3">
                  <p className="text-xs text-muted-foreground">Utilizado</p>
                  <p className="font-heading text-lg font-bold tabular-nums text-foreground" data-testid="budget-spent">
                    {formatBRL(data.spent)}
                  </p>
                </div>
                <div className="rounded-2xl bg-muted/60 p-3">
                  <p className="text-xs text-muted-foreground">Ainda pode gastar</p>
                  <p
                    className={cn(
                      "font-heading text-lg font-bold tabular-nums",
                      data.remaining >= 0 ? "text-income" : "text-expense",
                    )}
                    data-testid="budget-remaining"
                  >
                    {formatBRL(data.remaining)}
                  </p>
                </div>
                <div className="rounded-2xl bg-muted/60 p-3">
                  <p className="text-xs text-muted-foreground">Receita do mês</p>
                  <p className="font-heading text-lg font-bold tabular-nums text-foreground">{formatBRL(data.income)}</p>
                </div>
              </div>

              {data.planned > 0 ? (
                <div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(data.percent)} aria-valuemin={0} aria-valuemax={100} aria-label={`Orçamento total: ${overallMeta.label}`}>
                    <div className={cn("h-full rounded-full transition-all duration-500", overallMeta.bar)} style={{ width: `${Math.min(data.percent, 100)}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
                    {Math.round(data.percent)}% do orçamento planejado
                  </p>
                </div>
              ) : null}

              {data.unbudgeted_spent > 0 ? (
                <p className="rounded-xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground" data-testid="budget-unbudgeted">
                  <strong className="font-heading text-foreground">{formatBRL(data.unbudgeted_spent)}</strong> saíram em
                  categorias sem limite definido. Defina um limite para acompanhá-las aqui.
                </p>
              ) : null}
            </CardContent>
          </Card>

          {grouped.map(({ group, rows }) =>
            rows.length === 0 ? null : (
              <Card key={group} data-testid={`budget-group-${group}`}>
                <CardHeader className="flex flex-row items-center justify-between pb-0">
                  <CardTitle className="font-heading text-base">{GROUP_LABEL[group]}</CardTitle>
                  <Badge variant="secondary" className="text-xs tabular-nums">
                    {formatBRL(rows.reduce((s, r) => s + r.spent, 0))}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y divide-border">
                    {rows.map((row) => (
                      <BudgetRowItem
                        key={row.category_id}
                        row={row}
                        onEdit={() => dialogs.openCategory({ categoryId: row.category_id })}
                      />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ),
          )}
        </>
      )}
    </div>
  );
}
