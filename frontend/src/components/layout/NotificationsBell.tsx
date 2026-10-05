import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, CalendarClock, CreditCard, Radar as RadarIcon, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { clearNotifications, dismissNotification, fetchNotifications, fetchRadar, updateRadarSignal } from "@/lib/data";
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
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const origin = sessionStorage.getItem("finnos:notifications-return-origin");
    if (!origin) return;
    const here = `${location.pathname}${location.search}`;
    if (here === origin) {
      sessionStorage.removeItem("finnos:notifications-return-origin");
      setOpen(true);
    }
  }, [location.pathname, location.search]);

  const openNotificationTarget = (target: string) => {
    sessionStorage.setItem("finnos:notifications-return-origin", `${location.pathname}${location.search}`);
    setOpen(false);
    navigate(target, { state: { fromNotifications: true } });
  };
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchNotifications,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60_000,
  });
  const { data: radar } = useQuery({
    queryKey: ["radar"],
    queryFn: fetchRadar,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60_000,
  });
  const items = data?.items ?? [];
  const radarItems = (radar?.items ?? [])
    .filter((item) => item.severity === "critical" || item.severity === "high")
    .slice(0, 3);
  const totalItems = items.length + radarItems.length;
  const overdue = items.some((item) => item.kind === "atrasado") || radarItems.some((item) => item.severity === "critical");

  const dismissMutation = useMutation({
    mutationFn: async (entry: { kind: "notification" | "radar"; id: string }) => {
      if (entry.kind === "radar") await updateRadarSignal(entry.id, "dismiss");
      else await dismissNotification(entry.id);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
        queryClient.invalidateQueries({ queryKey: ["radar"] }),
      ]);
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      await Promise.all([
        clearNotifications(items.map((item) => item.id)),
        ...radarItems.map((item) => updateRadarSignal(item.id, "dismiss")),
      ]);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
        queryClient.invalidateQueries({ queryKey: ["radar"] }),
      ]);
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label={`Notificações (${totalItems})`}
        data-testid="notifications-bell"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {totalItems > 0 ? (
          <span
              className={cn(
                "absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white",
                overdue ? "bg-destructive" : "bg-primary",
              )}
              data-testid="notifications-badge"
            >
              {totalItems}
            </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" data-testid="notifications-panel">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <p className="font-heading text-sm font-semibold text-foreground">Avisos</p>
            <p className="text-xs text-muted-foreground">Vencimentos, faturas e Radar importantes.</p>
          </div>
          {totalItems > 0 ? (
            <button
              type="button"
              className="shrink-0 text-xs font-medium text-primary hover:underline disabled:opacity-50"
              disabled={clearMutation.isPending}
              onClick={() => clearMutation.mutate()}
              data-testid="notifications-clear-all"
            >
              Limpar
            </button>
          ) : null}
        </div>
        {totalItems === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="notifications-empty">
            Nada vencendo por agora. Tudo em ordem.
          </p>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto" data-testid="notifications-list">
            {radarItems.map((item) => (
              <li
                key={`radar-${item.id}`}
                role="button"
                tabIndex={0}
                onClick={() => openNotificationTarget(`/radar/${encodeURIComponent(item.id)}`)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openNotificationTarget(`/radar/${encodeURIComponent(item.id)}`); } }}
                className="flex cursor-pointer gap-3 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                data-testid={`notification-radar-${item.id}`}
              >
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", item.severity === "critical" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")} aria-hidden="true">
                  <RadarIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">Radar FINNOS · {item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Dispensar aviso"
                  onClick={(event) => {
                    event.stopPropagation();
                    dismissMutation.mutate({ kind: "radar", id: item.id });
                  }}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
            {items.map((item) => {
              const Icon = ICON[item.kind];
              return (
                <li
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openNotificationTarget(item.target_url)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openNotificationTarget(item.target_url); } }}
                  className="flex cursor-pointer gap-3 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  data-testid={`notification-${item.id}`}
                >
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
                  <button
                    type="button"
                    className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Dispensar aviso"
                    onClick={(event) => {
                      event.stopPropagation();
                      dismissMutation.mutate({ kind: "notification", id: item.id });
                    }}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
