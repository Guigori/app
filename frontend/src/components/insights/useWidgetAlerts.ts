/** The library's critical notices for the bell, plus a phone notification the first time each one appears. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { currentMonth, todayISO } from "@/lib/format";
import { widgetAlerts, type WidgetAlert } from "@/lib/insights/alerts";
import { balanceForecast } from "@/lib/insights/forecast";
import { monthRange } from "@/lib/insights/fixedBills";
import { nextInvoices } from "@/lib/insights/upcoming";
import { useAccounts, useBalanceHistory, useBudget, useCalendar, useCards, useOpenTransactions } from "@/components/insights/useInsightData";
import { useCatalogCtx } from "@/components/insights/CatalogInsight";
import { DISCOVERY_NEEDS, discoveries } from "@/lib/insights/discoveries";
import { detailPath } from "@/lib/insights/registry";

const DISMISSED = "finnos:widget-alerts:dismissed";
const NOTIFIED = "finnos:widget-alerts:notified";
const readSet = (key: string) => { try { return new Set<string>(JSON.parse(localStorage.getItem(key) ?? "[]")); } catch { return new Set<string>(); } };
const writeSet = (key: string, set: Set<string>) => { try { localStorage.setItem(key, JSON.stringify([...set].slice(-60))); } catch { /* storage unavailable */ } };

async function notify(alert: WidgetAlert) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
  const options = { body: alert.description, icon: "/brand/finnos-icon.png", badge: "/brand/finnos-icon.png", tag: alert.id, data: { url: alert.target } };
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) { await reg.showNotification(alert.title, options); return; }
    const n = new Notification(alert.title, options);
    n.onclick = () => { window.focus(); window.location.assign(alert.target); };
  } catch { /* the notice stays in the bell */ }
}

export function useWidgetAlerts() {
  const today = todayISO();
  const month = currentMonth();
  const cards = useCards();
  const accounts = useAccounts();
  const history = useBalanceHistory(month);
  const calendar = useCalendar(month);
  const budget = useBudget(month);
  const open = useOpenTransactions(today, monthRange(month).end);
  const [dismissed, setDismissed] = useState(() => readSet(DISMISSED));
  // Descobertas FINNOS: what turned red (late, over a limit, the month going negative) also becomes a notice.
  const ctx = useCatalogCtx(DISCOVERY_NEEDS);

  const all = useMemo(() => {
    // A notice is a bonus: whatever the data looks like, it never takes the header (and the screen) down.
    if (!Array.isArray(cards.data) || !Array.isArray(accounts.data)) return [];
    try {
      const invoices = nextInvoices(cards.data, accounts.data, today);
      let forecast = null;
      try {
        forecast = history.data && !Array.isArray(history.data) && calendar.data && Array.isArray(open.data) ? balanceForecast(history.data, open.data, invoices, calendar.data.planned ?? [], today) : null;
      } catch { forecast = null; }
      const b = budget.data && typeof budget.data.planned === "number" ? { month, planned: budget.data.planned, spent: budget.data.spent } : null;
      const base = widgetAlerts({ invoices, forecast, budget: b, today });
      let found: WidgetAlert[] = [];
      try {
        found = ctx ? discoveries(ctx, 12).filter((d) => d.tone === "bad" && !base.some((a) => a.insight === d.id)).map((d) => ({
          // The text is part of the id: the same discovery with new numbers is a new notice.
          id: `descoberta:${d.id}:${month}:${d.text.length}:${d.text.slice(0, 40)}`,
          insight: d.id, title: d.title, description: d.text, target: detailPath(d.id), critical: true,
        })) : [];
      } catch { found = []; }
      return [...base, ...found];
    } catch {
      return [];
    }
  }, [cards.data, accounts.data, history.data, calendar.data, open.data, budget.data, today, month, ctx]);
  const alerts = useMemo(() => all.filter((a) => !dismissed.has(a.id)), [all, dismissed]);

  useEffect(() => {
    const notified = readSet(NOTIFIED);
    const fresh = alerts.filter((a) => a.critical && !notified.has(a.id));
    if (!fresh.length) return;
    fresh.forEach((a) => { notified.add(a.id); void notify(a); });
    writeSet(NOTIFIED, notified);
  }, [alerts]);

  const dismiss = useCallback((ids: string[]) => {
    setDismissed((cur) => { const next = new Set(cur); ids.forEach((id) => next.add(id)); writeSet(DISMISSED, next); return next; });
  }, []);
  return { alerts, dismiss };
}
