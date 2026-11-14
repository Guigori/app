import { useQuery } from "@tanstack/react-query";
import { fetchNotifications, fetchRadar, fetchSubscriptions } from "@/lib/data";
import { formatBRL } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";

export type MenuBadge = { text: string; tone: "alert" | "warn" | "info"; count?: number };

/**
 * The short values and alerts beside menu items: bills due in Orçamento, open signals in Radar, the
 * monthly cost in Assinaturas. Shares the cache of the screens that already load the same data.
 */
export function useMenuBadges(enabled: boolean): Partial<Record<string, MenuBadge>> {
  const opts = { enabled, staleTime: 60_000, retry: false } as const;
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: fetchNotifications, ...opts });
  const radar = useQuery({ queryKey: ["radar"], queryFn: fetchRadar, ...opts });
  const subscriptions = useQuery({ queryKey: ["subscriptions"], queryFn: fetchSubscriptions, ...opts });
  const { hidden } = useBalanceHidden();
  if (!enabled) return {};
  const badges: Partial<Record<string, MenuBadge>> = {};
  const due = (notifications.data?.items ?? []).filter((item) =>
    item.kind === "atrasado" || ((item.kind === "vencimento" || item.kind === "fatura") && item.days_left <= 3)).length;
  if (due > 0) badges.orcamento = { text: due === 1 ? "1 vencendo" : `${due} vencendo`, tone: "alert", count: due };
  const signals = (radar.data?.items ?? []).filter((item) => item.state === "new" || item.state === "active").length;
  if (signals > 0) badges.radar = { text: signals === 1 ? "1 alerta" : `${signals} alertas`, tone: "warn", count: signals };
  const monthly = subscriptions.data?.monthly_total ?? 0;
  // With values hidden, the amount stays out of the menu too.
  if (monthly > 0 && !hidden) badges.assinaturas = { text: `${formatBRL(monthly).replace(/,00$/, "")}/mês`, tone: "info" };
  return badges;
}
