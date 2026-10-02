import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bell, CalendarClock, CreditCard } from "lucide-react";
import { fetchNotifications } from "@/lib/data";
import { formatBRL, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { NotificationKind } from "@/types/finnos";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ICON: Record<NotificationKind, typeof Bell> = {
  vencimento: CalendarClock,
  atrasado: AlertTriangle,
  fatura: CreditCard,
};

/** Bell with a live badge: scheduled/pending entries coming due, overdue ones and card
 *  invoices closing within the next week. */
export function NotificationsBell() {
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchNotifications,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60_000,
  });
  const items = data?.items ?? [];
  const overdue = items.some((item) => item.kind === "atrasado");

  return (
    <Popover>
      <PopoverTrigger
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label={`Notificações (${items.length})`}
        data-testid="notifications-bell"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {items.length > 0 ? (
          <span
              className={cn(
                "absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white",
                overdue ? "bg-destructive" : "bg-primary",
              )}
              data-testid="notifications-badge"
            >
              {items.length}
            </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" data-testid="notifications-panel">
        <div className="border-b border-border px-4 py-3">
          <p className="font-heading text-sm font-semibold text-foreground">Avisos</p>
          <p className="text-xs text-muted-foreground">Contas a vencer nos próximos 7 dias e faturas chegando.</p>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="notifications-empty">
            Nada vencendo por agora. Tudo em ordem.
          </p>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto" data-testid="notifications-list">
            {items.map((item) => {
              const Icon = ICON[item.kind];
              return (
                <li key={item.id} className="flex gap-3 px-4 py-3" data-testid={`notification-${item.id}`}>
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                      item.kind === "atrasado" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDate(item.date)}
                      {item.value > 0 ? ` · ${formatBRL(item.value)}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
