import { Badge } from "@/components/ui/badge";
import { TX_STATUS_LABEL, TX_TYPE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TxStatus, TxType } from "@/types/finnos";

const STATUS_STYLES: Record<TxStatus, string> = {
  pago: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  pendente: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  agendado: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
};

export function StatusBadge({ status }: { status: TxStatus }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", STATUS_STYLES[status])} data-testid="status-badge">
      {TX_STATUS_LABEL[status]}
    </Badge>
  );
}

const TYPE_STYLES: Record<TxType, string> = {
  receita: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  despesa: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  transferencia: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
};

export function TypeBadge({ type }: { type: TxType }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", TYPE_STYLES[type])} data-testid="type-badge">
      {TX_TYPE_LABEL[type]}
    </Badge>
  );
}
