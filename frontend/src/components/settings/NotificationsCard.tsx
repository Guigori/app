import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fetchNotifyPrefs, saveNotifyPrefs, sendTestPush } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { disablePush, enablePush, pushAvailable } from "@/lib/push";
import { isLocalMode } from "@/lib/mode";
import type { NotifyPrefsInput } from "@/types/finnos";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS = [0, 1, 2, 3, 5, 7];

const dayLabel = (days: number) =>
  days === 0 ? "No dia do vencimento" : days === 1 ? "1 dia antes" : `${days} dias antes`;

/** Reminder settings: push on this device, e-mail, hour of the day and how early. */
export function NotificationsCard() {
  const queryClient = useQueryClient();
  const local = isLocalMode();
  const [working, setWorking] = useState(false);
  const [form, setForm] = useState<NotifyPrefsInput>({
    push_enabled: true,
    email_enabled: false,
    hour: 9,
    days_before: 1,
    transaction_reminders: true,
    invoice_reminders: true,
    radar_alerts: true,
    activity_reminders: true,
    weekly_summary: true,
    system_notices: true,
  });

  const prefsQuery = useQuery({ queryKey: ["notify-prefs"], queryFn: fetchNotifyPrefs });
  const prefs = prefsQuery.data;

  useEffect(() => {
    if (!prefs) return;
    setForm({
      push_enabled: prefs.push_enabled,
      email_enabled: prefs.email_enabled,
      hour: prefs.hour,
      days_before: prefs.days_before,
      transaction_reminders: prefs.transaction_reminders,
      invoice_reminders: prefs.invoice_reminders,
      radar_alerts: prefs.radar_alerts,
      activity_reminders: prefs.activity_reminders,
      weekly_summary: prefs.weekly_summary,
      system_notices: prefs.system_notices,
    });
  }, [prefs]);

  const saveMutation = useMutation({
    mutationFn: (input: NotifyPrefsInput) => saveNotifyPrefs(input),
    onSuccess: async () => {
      toast.success("Preferências de aviso salvas.");
      await queryClient.invalidateQueries({ queryKey: ["notify-prefs"] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });

  return (
    <section className="rounded-3xl border border-border bg-card p-5" data-testid="notifications-card">
      <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
        <BellRing className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
        Avisos de vencimento
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Escolha quais tipos de aviso o FINNOS pode enviar para este aparelho.
      </p>

      <div className="mt-4 space-y-3">
        <label className="flex items-start gap-3 text-sm text-foreground">
          <Checkbox
            checked={form.push_enabled}
            onCheckedChange={(v) => setForm((f) => ({ ...f, push_enabled: v === true }))}
            data-testid="notify-push-checkbox"
          />
          <span>
            Aviso no celular (push)
            <span className="block text-xs text-muted-foreground" data-testid="notify-devices">
              {prefs?.push_devices ? `${prefs.push_devices} aparelho(s) registrado(s)` : "Nenhum aparelho registrado ainda"}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm text-foreground">
          <Checkbox
            checked={form.email_enabled}
            onCheckedChange={(v) => setForm((f) => ({ ...f, email_enabled: v === true }))}
            data-testid="notify-email-checkbox"
          />
          <span>
            Aviso por e-mail
            <span className="block text-xs text-muted-foreground">Enviado para o e-mail da sua conta.</span>
          </span>
        </label>
      </div>

      <div className="mt-5 rounded-2xl border border-border p-4">
        <p className="font-heading text-sm font-semibold text-foreground">Tipos de notificação</p>
        <p className="mt-1 text-xs text-muted-foreground">Você pode ativar ou desativar cada grupo sem desligar todos os avisos.</p>
        <div className="mt-4 space-y-3">
          {([
            ["transaction_reminders", "Contas e lançamentos", "Vencimentos, contas a pagar e movimentações agendadas."],
            ["invoice_reminders", "Faturas de cartão", "Fechamento e vencimento das faturas."],
            ["radar_alerts", "Radar FINNOS", "Riscos, desvios e oportunidades importantes."],
            ["activity_reminders", "Lembretes de registro", "Avisos para manter suas movimentações atualizadas."],
            ["weekly_summary", "Resumo semanal", "Resumo dos lançamentos e gastos da semana."],
            ["system_notices", "Avisos do sistema", "Novidades, segurança e comunicações importantes do FINNOS."],
          ] as const).map(([key, title, description]) => (
            <label key={key} className="flex items-start gap-3 text-sm text-foreground">
              <Checkbox
                checked={form[key]}
                onCheckedChange={(value) => setForm((current) => ({ ...current, [key]: value === true }))}
                data-testid={`notify-${key}`}
              />
              <span>
                {title}
                <span className="block text-xs text-muted-foreground">{description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="notify-hour">Horário do aviso</Label>
          <Select value={String(form.hour)} onValueChange={(v) => setForm((f) => ({ ...f, hour: Number(v) }))}>
            <SelectTrigger id="notify-hour" className="w-full" aria-label="Horário do aviso" data-testid="notify-hour-select">
              <SelectValue>{`${String(form.hour).padStart(2, "0")}:00`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {`${String(h).padStart(2, "0")}:00`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Horário de Brasília.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="notify-days">Antecedência</Label>
          <Select value={String(form.days_before)} onValueChange={(v) => setForm((f) => ({ ...f, days_before: Number(v) }))}>
            <SelectTrigger id="notify-days" className="w-full" aria-label="Antecedência do aviso" data-testid="notify-days-select">
              <SelectValue>{dayLabel(form.days_before)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {DAYS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {dayLabel(d)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending} data-testid="notify-save-button">
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Salvar preferências
        </Button>
        <Button
          variant="outline"
          disabled={working || !pushAvailable()}
          onClick={async () => {
            setWorking(true);
            try {
              if (local) {
                if (!("Notification" in window) || !("serviceWorker" in navigator)) throw new Error("Este navegador não suporta notificações.");
                const permission = await Notification.requestPermission();
                if (permission !== "granted") throw new Error("Permissão de notificação não concedida.");
                await navigator.serviceWorker.register("/sw.js");
                await navigator.serviceWorker.ready;
              } else {
                await enablePush();
              }
              await queryClient.invalidateQueries({ queryKey: ["notify-prefs"] });
              toast.success("Aparelho registrado para receber avisos.");
            } catch (error) {
              toast.error(getApiErrorMessage(error));
            } finally {
              setWorking(false);
            }
          }}
          data-testid="notify-enable-device-button"
        >
          Ativar neste aparelho
        </Button>
        <Button
          variant="ghost"
          disabled={working}
          onClick={async () => {
            setWorking(true);
            try {
              const result = await sendTestPush();
              toast[result.sent > 0 ? "success" : "info"](
                result.sent > 0 ? "Aviso de teste enviado." : "Nenhum aparelho registrado — ative neste aparelho primeiro.",
              );
            } catch (error) {
              toast.error(getApiErrorMessage(error));
            } finally {
              setWorking(false);
            }
          }}
          data-testid="notify-test-button"
        >
          Enviar teste
        </Button>
        <Button
          variant="ghost"
          disabled={working || !pushAvailable()}
          onClick={async () => {
            setWorking(true);
            try {
              if (!local) await disablePush();
              setForm((current) => ({ ...current, push_enabled: false }));
              await queryClient.invalidateQueries({ queryKey: ["notify-prefs"] });
              toast.success(local ? "Avisos desativados nas preferências locais." : "Aparelho removido dos avisos.");
            } catch (error) {
              toast.error(getApiErrorMessage(error));
            } finally {
              setWorking(false);
            }
          }}
          data-testid="notify-disable-device-button"
        >
          Remover este aparelho
        </Button>
      </div>
      {!pushAvailable() ? (
        <p className="mt-3 text-xs text-muted-foreground" data-testid="notify-unsupported">
          Este navegador não suporta avisos push. No iPhone, instale o FINNOS na tela inicial para receber avisos como um app.
        </p>
      ) : null}
    </section>
  );
}
