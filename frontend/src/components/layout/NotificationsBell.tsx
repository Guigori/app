/**
 * O sino e a tela de notificações. Agrupa o que pede ação (atrasadas, vencendo, compras para revisar), os cartões e
 * saldos, e as análises e sinais do Radar. Tocar numa notificação abre exatamente aquilo de que ela fala: o lançamento
 * no registro novo, a fatura do ciclo, a compra para revisar, a análise ou o sinal. O × tira só aquela.
 */
import { useEffect, useMemo, useState } from "react";
import { STALE_LISTENING, useLiveUpdates } from "@/lib/liveUpdates";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, CalendarClock, ChevronRight, CreditCard, LayoutGrid, Radar as RadarIcon, ReceiptText, Wallet, X } from "lucide-react";
import { useWidgetAlerts } from "@/components/insights/useWidgetAlerts";
import { useLocation, useNavigate } from "react-router-dom";
import { clearNotifications, dismissNotification, fetchNotifications, fetchRadar, fetchTransaction, updateRadarSignal } from "@/lib/data";
import { formatBRL, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { NotificationItem, NotificationKind } from "@/types/finnos";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

const ICON: Record<NotificationKind, typeof Bell> = { vencimento: CalendarClock, atrasado: AlertTriangle, fatura: CreditCard, captura: ReceiptText, saldo: Wallet };

type Entry = {
  key: string; group: "acao" | "contas" | "analises"; icon: typeof Bell; tone: "red" | "amber" | "primary";
  title: string; text: string; meta?: string; action: string; open: () => void; dismiss: () => void; testId: string;
};

const GROUPS: [Entry["group"], string][] = [["acao", "Para resolver"], ["contas", "Cartões e saldos"], ["analises", "Análises e Radar"]];
const TONE = { red: "bg-expense/10 text-expense", amber: "bg-amber-500/12 text-amber-600 dark:text-amber-400", primary: "bg-primary/10 text-primary" } as const;

/** The transaction a notification is about (Fluxo links carry ?highlight=<id>). */
const txIdOf = (url: string) => { try { return new URL(url, "https://x").searchParams.get("highlight"); } catch { return null; } };

export function NotificationsBell() {
  const live = useLiveUpdates();
  const navigate = useNavigate();
  const location = useLocation();
  const dialogs = useDialogs();
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"right" | "bottom">("bottom");
  const queryClient = useQueryClient();
  useEffect(() => { setSide(window.matchMedia("(min-width: 1024px)").matches ? "right" : "bottom"); }, [open]);

  // Back from a notification's screen, the list opens again where the person was.
  useEffect(() => {
    const origin = sessionStorage.getItem("finnos:notifications-return-origin");
    if (!origin) return;
    if (`${location.pathname}${location.search}` === origin) { sessionStorage.removeItem("finnos:notifications-return-origin"); setOpen(true); }
  }, [location.pathname, location.search]);

  const go = (target: string, anchor?: string) => {
    sessionStorage.setItem("finnos:notifications-return-origin", `${location.pathname}${location.search}`);
    setOpen(false);
    navigate(target, { state: { fromNotifications: true } });
    if (anchor) {
      // The anchored part (compras para revisar) appears once the screen has its data.
      let tries = 0;
      const find = () => { const el = document.getElementById(anchor); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); else if (tries++ < 30) window.setTimeout(find, 100); };
      window.setTimeout(find, 150);
    }
  };
  const openTx = async (item: NotificationItem) => {
    const id = txIdOf(item.target_url);
    setOpen(false);
    const tx = id ? await fetchTransaction(id).catch(() => null) : null;
    if (tx) dialogs.openTransactionDetail(tx); else go(item.target_url);
  };

  const opts = { refetchInterval: live ? false : 15 * 60 * 1000, staleTime: live ? STALE_LISTENING : 5 * 60_000 } as const;
  const { data } = useQuery({ queryKey: ["notifications"], queryFn: fetchNotifications, ...opts });
  const { data: radar } = useQuery({ queryKey: ["radar"], queryFn: fetchRadar, ...opts });
  const items = useMemo(() => data?.items ?? [], [data]);
  const radarItems = useMemo(() => (radar?.items ?? []).filter((i) => i.severity === "critical" || i.severity === "high").slice(0, 3), [radar]);
  const { alerts: widgetAlerts, dismiss: dismissWidgetAlerts } = useWidgetAlerts();

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["notifications"] }), queryClient.invalidateQueries({ queryKey: ["radar"] })]);
  const dismissMutation = useMutation({
    mutationFn: async (e: { kind: "notification" | "radar"; id: string }) => { if (e.kind === "radar") await updateRadarSignal(e.id, "dismiss"); else await dismissNotification(e.id); },
    onSuccess: refresh,
  });
  const clearMutation = useMutation({
    mutationFn: async () => {
      dismissWidgetAlerts(widgetAlerts.map((a) => a.id));
      await Promise.all([clearNotifications(items.map((i) => i.id)), ...radarItems.map((i) => updateRadarSignal(i.id, "dismiss"))]);
    },
    onSuccess: refresh,
  });

  // An analysis that repeats a bill already listed ("Contas em aberto") stays out: the bill itself is the notification.
  const hasBills = items.some((i) => i.kind === "atrasado" || i.kind === "vencimento");
  const entries: Entry[] = [
    ...items.map((item): Entry => {
      const tx = item.kind === "atrasado" || item.kind === "vencimento";
      const meta = [formatDate(item.date), item.value > 0 ? formatBRL(item.value) : null, item.kind === "vencimento" && item.days_left >= 0 ? (item.days_left === 0 ? "vence hoje" : item.days_left === 1 ? "vence amanhã" : `em ${item.days_left} dias`) : null].filter(Boolean).join(" · ");
      return {
        key: item.id, group: tx || item.kind === "captura" ? "acao" : "contas", icon: ICON[item.kind],
        tone: item.kind === "atrasado" ? "red" : item.kind === "captura" || item.kind === "vencimento" ? "amber" : "primary",
        title: item.title, text: item.description, meta,
        action: tx ? "Abrir o lançamento" : item.kind === "captura" ? "Revisar a compra" : item.kind === "fatura" ? "Abrir a fatura" : "Abrir",
        open: () => (tx ? void openTx(item) : item.kind === "captura" ? go("/transacoes", "compras-para-revisar") : go(item.target_url)),
        dismiss: () => dismissMutation.mutate({ kind: "notification", id: item.id }), testId: `notification-${item.id}`,
      };
    }),
    ...widgetAlerts.filter((a) => !(hasBills && a.insight === "em-aberto")).map((a): Entry => ({
      key: a.id, group: "analises", icon: a.insight === "fatura-que-vem" ? CreditCard : LayoutGrid, tone: a.critical ? "red" : "primary",
      title: a.title, text: a.description, action: "Abrir a análise", open: () => go(a.target), dismiss: () => dismissWidgetAlerts([a.id]), testId: `notification-widget-${a.insight}`,
    })),
    ...radarItems.map((r): Entry => ({
      key: `radar-${r.id}`, group: "analises", icon: RadarIcon, tone: r.severity === "critical" ? "red" : "amber",
      title: r.title, text: r.description, meta: "Radar FINNOS", action: "Abrir o sinal", open: () => go(`/radar/${encodeURIComponent(r.id)}`),
      dismiss: () => dismissMutation.mutate({ kind: "radar", id: r.id }), testId: `notification-radar-${r.id}`,
    })),
  ];
  const total = entries.length;
  const urgent = entries.some((e) => e.tone === "red");

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Notificações (${total})`} data-testid="notifications-bell"
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <Bell className="h-5 w-5" aria-hidden="true" />
        {total > 0 ? <span className={cn("absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-xs font-bold text-white", urgent ? "bg-destructive" : "bg-primary")} data-testid="notifications-badge">{total > 99 ? "99+" : total}</span> : null}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={side} className={cn("gap-0 overflow-hidden p-0", side === "bottom" ? "max-h-[88svh] rounded-t-3xl" : "w-full sm:max-w-md")} data-testid="notifications-panel">
          <div className="flex items-start justify-between gap-3 border-b border-border pb-3 pl-16 pr-5 pt-5">
            <div className="min-w-0">
              <SheetTitle className="font-heading text-xl leading-9">Notificações</SheetTitle>
              <SheetDescription className="text-xs">{total ? `${total} ${total === 1 ? "aviso" : "avisos"}. Toque para abrir.` : "Tudo em ordem por agora."}</SheetDescription>
            </div>
            {total > 0 ? <button type="button" className="mt-2 shrink-0 text-xs font-semibold text-primary disabled:opacity-50" disabled={clearMutation.isPending} onClick={() => clearMutation.mutate()} data-testid="notifications-clear-all">Limpar tudo</button> : null}
          </div>
          {total === 0 ? (
            <div className="grid place-items-center gap-2 px-6 py-12 text-center" data-testid="notifications-empty">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-income/10 text-income"><Bell className="h-6 w-6" /></span>
              <p className="text-sm font-semibold">Nada vencendo por agora</p>
              <p className="text-xs text-muted-foreground">Contas, faturas, compras para revisar e análises importantes aparecem aqui.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-6 pt-3" data-testid="notifications-list">
              {GROUPS.map(([g, label]) => {
                const list = entries.filter((e) => e.group === g);
                if (!list.length) return null;
                return (
                  <section key={g}>
                    <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label} · {list.length}</p>
                    <ul className="overflow-hidden rounded-2xl border border-border bg-card">
                      {list.map((e) => (
                        <li key={e.key} className="flex items-start gap-1 border-b border-border/60 last:border-0" data-testid={e.testId}>
                          <button type="button" onClick={e.open} className="flex min-w-0 flex-1 items-start gap-3 px-3.5 py-3 text-left hover:bg-muted/40">
                            <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", TONE[e.tone])} aria-hidden="true"><e.icon className="h-4 w-4" /></span>
                            <span className="min-w-0 flex-1">
                              <strong className="block text-sm leading-snug">{e.title}</strong>
                              {e.text ? <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{e.text}</span> : null}
                              {e.meta ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{e.meta}</span> : null}
                              <span className="mt-1 inline-flex items-center gap-0.5 text-xs font-semibold text-primary">{e.action}<ChevronRight className="h-3.5 w-3.5" /></span>
                            </span>
                          </button>
                          <button type="button" onClick={e.dismiss} aria-label={`Dispensar: ${e.title}`} className="mr-1.5 mt-2 grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
