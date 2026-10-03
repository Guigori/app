import { AlertTriangle, CheckCircle2, CircleDashed, XCircle, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RuleItem, RuleStatus } from "@/types/finnos";

const STATUS_META: Record<RuleStatus, { label: string; icon: LucideIcon; bar: string; text: string }> = {
  dentro: {
    label: "Dentro do orçamento",
    icon: CheckCircle2,
    bar: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-400",
  },
  proximo: {
    label: "Próximo do limite",
    icon: AlertTriangle,
    bar: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-400",
  },
  acima: {
    label: "Acima do orçamento",
    icon: XCircle,
    bar: "bg-rose-500",
    text: "text-rose-700 dark:text-rose-400",
  },
};

const GROUP_PILL: Record<string, string> = {
  necessidades: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  desejos: "bg-pink-500/10 text-pink-700 dark:text-pink-300",
  metas: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

interface Budget503020CardProps {
  month: string;
  income: number;
  rule: RuleItem[];
}

export function Budget503020Card({ month, income, rule }: Budget503020CardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">Planejamento 50/30/20</CardTitle>
        <CardDescription>
          Como a receita de {month.toLowerCase()} se divide entre necessidades, desejos e metas. O FINNOS apenas
          informa — nada é bloqueado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {income === 0 ? (
          <p className="rounded-xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground" data-testid="rule-no-income">
            Sem receitas registradas neste mês, os limites usam 50/30/20 como referência zerada.
          </p>
        ) : null}
        {rule.map((item) => {
          const isZero = item.spent <= 0;
          const isGoal = item.key === "metas";
          const meta = STATUS_META[item.status];
          const displayMeta = isZero
            ? { label: isGoal ? "Meta ainda não iniciada" : "Ainda não utilizado", icon: CircleDashed, bar: "bg-muted-foreground/30", text: "text-muted-foreground" }
            : isGoal
              ? { ...meta, label: item.percent >= 100 ? "Meta atingida" : `${Math.round(item.percent)}% da meta` }
              : meta;
          const StatusIcon = displayMeta.icon;
          return (
            <div key={item.key} data-testid={`rule-row-${item.key}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn("rounded-full px-3 py-1 text-xs font-semibold", GROUP_PILL[item.key])}
                  >
                    {item.label}
                  </span>
                  <span className={cn("inline-flex items-center gap-1 text-xs font-medium", displayMeta.text)} data-testid={`rule-status-${item.key}`}>
                    <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    {displayMeta.label}
                  </span>
                </div>
                <span className="font-heading text-sm font-bold tabular-nums text-foreground" data-testid={`rule-percent-${item.key}`}>
                  {Math.round(item.percent)}%
                </span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(item.percent)} aria-valuemin={0} aria-valuemax={100} aria-label={`${item.label}: ${displayMeta.label}`}>
                <div className={cn("h-full rounded-full transition-all duration-500", displayMeta.bar)} style={{ width: `${Math.min(item.percent, 100)}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground tabular-nums" data-testid={`rule-values-${item.key}`}>
                {formatBRL(item.spent)} de {formatBRL(item.limit)}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
