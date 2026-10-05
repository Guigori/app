import { useEffect, useState } from "react";
import { BellRing, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { fetchNotifications, fetchNotifyPrefs, fetchRadar } from "@/lib/data";
import { isLocalMode } from "@/lib/mode";
import { enablePush, pushAvailable } from "@/lib/push";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DISMISS_KEY = "finnos:notifications-prompt-dismissed-at";
const LOCAL_SHOWN_KEY = "finnos:local-native-notifications";

function shouldAskAgain(): boolean {
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return true;
  const last = Number(raw);
  return !Number.isFinite(last) || Date.now() - last > 7 * 24 * 60 * 60 * 1000;
}

async function enableLocalNotifications(): Promise<void> {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    throw new Error("Este navegador não oferece notificações para o FINNOS.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permissão de notificação não concedida.");
  await navigator.serviceWorker.register("/sw.js");
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification("FINNOS", {
    body: "Avisos ativados neste aparelho.",
    icon: "/brand/finnos-icon.png",
    badge: "/brand/finnos-icon.png",
    tag: "finnos-notifications-enabled",
    data: { url: "/" },
  });
}

/**
 * One-time, user-initiated permission prompt. Native browser permission is only
 * requested after the user taps "Permitir notificações".
 */
export function NotificationPermissionPrompt() {
  const local = isLocalMode();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    if (!shouldAskAgain()) return;
    const timer = window.setTimeout(() => setOpen(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);

  const activate = async () => {
    setWorking(true);
    try {
      if (local) await enableLocalNotifications();
      else await enablePush();
      localStorage.removeItem(DISMISS_KEY);
      toast.success("Notificações ativadas neste aparelho.");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível ativar as notificações.");
    } finally {
      setWorking(false);
    }
  };

  const later = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) later(); }}>
      <DialogContent className="sm:max-w-md" data-testid="notification-permission-prompt">
        <DialogHeader>
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <BellRing className="h-6 w-6" aria-hidden="true" />
          </div>
          <DialogTitle>Quer receber os avisos do FINNOS?</DialogTitle>
          <DialogDescription>
            Ative notificações para contas a pagar, vencimentos, Radar, lembretes de registro,
            incentivos e avisos importantes do sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-2xl border border-border bg-muted/35 p-3 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <p>
              Você continua no controle: avisos de uma transação podem ser desligados individualmente nas opções do lançamento.
              {local ? " No modo local, os avisos nativos funcionam enquanto o FINNOS estiver ativo neste aparelho." : ""}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" onClick={later} disabled={working}>
            Agora não
          </Button>
          <Button type="button" onClick={activate} disabled={working || (!local && !pushAvailable())}>
            {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Permitir notificações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Local/demo mode has no server that can wake a closed PWA. While FINNOS is
 * active, surface urgent due items and high-priority Radar signals as native
 * device notifications, once per item per day.
 */
export function LocalNotificationPulse() {
  useEffect(() => {
    if (!isLocalMode()) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const [notifications, radar, prefs] = await Promise.all([fetchNotifications(), fetchRadar(), fetchNotifyPrefs()]);
        if (cancelled) return;
        const today = new Date().toISOString().slice(0, 10);
        const shown = JSON.parse(localStorage.getItem(LOCAL_SHOWN_KEY) || "{}") as Record<string, string>;
        const registration = await navigator.serviceWorker.ready;

        const candidates = [
          ...notifications.items
            .filter((item) => item.days_left <= 1)
            .filter((item) => item.kind === "fatura" ? prefs.invoice_reminders : prefs.transaction_reminders)
            .map((item) => ({
              key: `money:${item.id}`,
              title: item.title,
              body: item.description,
              url: item.kind === "fatura" && item.id.startsWith("card-") ? `/cartoes/${item.id.slice(5)}` : "/transacoes",
            })),
          ...(prefs.radar_alerts ? (radar?.items ?? []) : [])
            .filter((item) => item.severity === "critical" || item.severity === "high")
            .slice(0, 3)
            .map((item) => ({
              key: `radar:${item.id}`,
              title: `Radar FINNOS · ${item.title}`,
              body: item.description,
              url: `/radar/${encodeURIComponent(item.id)}`,
            })),
        ];

        for (const item of candidates) {
          if (shown[item.key] === today) continue;
          await registration.showNotification(item.title, {
            body: item.body,
            icon: "/brand/finnos-icon.png",
            badge: "/brand/finnos-icon.png",
            tag: item.key,
            data: { url: item.url },
          });
          shown[item.key] = today;
        }
        localStorage.setItem(LOCAL_SHOWN_KEY, JSON.stringify(shown));
      } catch {
        // Native notifications are best-effort in local/demo mode.
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
