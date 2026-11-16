import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Smartphone } from "lucide-react";
import { DEVICE_FIRST_AFTER, deviceCopyAge, deviceFirstScreens, mirrorStatus, refreshMirror, refreshWait } from "@/lib/mirror";
import { getApiErrorMessage } from "@/lib/errors";

const SCREEN_NAMES: Record<string, string> = {
  dashboard: "Início", balanceHistory: "Evolução do saldo", calendar: "Calendário", transactions: "Lançamentos",
  flow: "Fluxo", trends: "Análise", budget: "Orçamento", accounts: "Carteira · contas", account: "Conta",
  cards: "Carteira · cartões", invoice: "Fatura", subscriptions: "Assinaturas",
  notifications: "Notificações", categories: "Categorias", institutions: "Bancos", transactionHistory: "Histórico",
  goals: "Patrimônio · metas", investments: "Patrimônio · investimentos",
};

function short(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text && text.length > 160 ? `${text.slice(0, 160)}…` : String(text);
}

/** Configurações → Dados e backup → Este aparelho: the account's copy kept on this device (lib/mirror.ts). */
export function DeviceCopySection() {
  useEffect(() => {
    if (window.location.hash === "#este-aparelho") document.getElementById("este-aparelho")?.scrollIntoView({ block: "center" });
  }, []);
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["device-copy-status"], queryFn: mirrorStatus, staleTime: 0 });
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(() => refreshWait());

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait(refreshWait()), Math.min(wait, 1000));
    return () => window.clearTimeout(timer);
  }, [wait]);

  if (status.data && !status.data.enabled) return null;
  const report = status.data?.report;
  const differences = report ? report.checked - report.matched : 0;

  const refresh = async () => {
    setBusy(true);
    try {
      const copy = await refreshMirror();
      if (!copy) throw new Error("Não foi possível atualizar agora. Confira a conexão.");
      await queryClient.invalidateQueries();
      toast.success("Dados deste aparelho atualizados.");
    } catch (error) {
      toast.error(getApiErrorMessage(error, error instanceof Error ? error.message : undefined));
    } finally {
      setBusy(false);
      setWait(refreshWait());
      void status.refetch();
    }
  };

  return (
    <div id="este-aparelho" className="scroll-mt-24 border-t border-border px-4 py-4" data-testid="settings-device-copy">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium"><Smartphone className="h-4 w-4 text-primary" />Este aparelho</p>
        <button type="button" disabled={busy || wait > 0} onClick={() => void refresh()}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50" data-testid="settings-device-refresh">
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Atualizando…" : wait > 0 ? `Aguarde ${Math.ceil(wait / 1000)} s` : "Atualizar agora"}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        O FINNOS guarda uma cópia dos seus dados neste aparelho e a busca de novo só quando algo muda. Use "Atualizar agora" se algum número parecer desatualizado.
      </p>
      <dl className="mt-3 space-y-1.5 rounded-xl border border-border px-3 py-2.5 text-xs" data-testid="settings-device-status">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Cópia</dt><dd className="font-medium">{status.isPending ? "…" : deviceCopyAge(status.data?.fetchedAt ?? null)}</dd></div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Conferência com o servidor</dt>
          <dd className="text-right font-medium">
            {!report || report.checked === 0 ? "ainda sem telas conferidas"
              : differences === 0 ? `${report.matched} de ${report.checked} telas iguais`
              : <span className="text-amber-600 dark:text-amber-400">{differences} {differences === 1 ? "diferença" : "diferenças"} em {report.checked} telas</span>}
          </dd>
        </div>
        {report && report.checked > 0 ? (
          <div className="flex justify-between gap-3" data-testid="settings-device-first">
            <dt className="text-muted-foreground">Abrindo pelo aparelho</dt>
            <dd className="text-right font-medium">
              {(() => {
                const ready = new Set(deviceFirstScreens(report));
                return Object.keys(SCREEN_NAMES).map((name) => {
                  const s = report.byScreen[name];
                  const label = SCREEN_NAMES[name];
                  if (ready.has(name)) return <span key={name} className="block text-emerald-600 dark:text-emerald-400">{label}: sim</span>;
                  if (s && s.matched !== s.checked) return <span key={name} className="block text-amber-600 dark:text-amber-400">{label}: pelo servidor (houve diferença)</span>;
                  return <span key={name} className="block">{label}: {Math.min(s?.matched ?? 0, DEVICE_FIRST_AFTER)} de {DEVICE_FIRST_AFTER} acertos</span>;
                });
              })()}
            </dd>
          </div>
        ) : null}
        {differences > 0 ? <p className="pt-1 text-muted-foreground">Os números que você vê continuam vindo do servidor; as diferenças só servem para conferir a cópia.</p> : null}
        {differences > 0 && report?.last.length ? (
          <details className="pt-1" data-testid="settings-device-differences">
            <summary className="cursor-pointer font-medium text-primary">Ver diferenças</summary>
            <ul className="mt-2 space-y-2">
              {report.last.slice(0, 3).map((d) => (
                <li key={`${d.at}-${d.params}`} className="rounded-lg bg-muted/50 px-2.5 py-2">
                  <p className="font-semibold">{SCREEN_NAMES[d.screen] ?? d.screen} <span className="font-normal text-muted-foreground">· {d.params}</span></p>
                  {d.fields.map((f) => (
                    <p key={f.field} className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                      {f.field}: servidor {short(f.server)} · aparelho {short(f.device)}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
            <button type="button" className="mt-2 text-xs font-semibold text-primary" data-testid="settings-device-copy-differences"
              onClick={() => void navigator.clipboard?.writeText(JSON.stringify(report.last.slice(0, 5), null, 1))
                .then(() => toast.success("Diferenças copiadas. Cole na conversa para conferirmos."))
                .catch(() => toast.error("Não foi possível copiar."))}>
              Copiar detalhes
            </button>
          </details>
        ) : null}
      </dl>
    </div>
  );
}
