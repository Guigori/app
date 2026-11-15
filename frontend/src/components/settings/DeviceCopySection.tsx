import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Smartphone } from "lucide-react";
import { mirrorStatus, refreshMirror, refreshWait } from "@/lib/mirror";
import { getApiErrorMessage } from "@/lib/errors";

function since(iso: string | null): string {
  if (!iso) return "ainda não atualizado";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "atualizado agora";
  if (minutes < 60) return `atualizado há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `atualizado há ${hours} h`;
  return `atualizado em ${new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`;
}

/** Configurações → Dados e backup → Este aparelho: the account's copy kept on this device (lib/mirror.ts). */
export function DeviceCopySection() {
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
    <div className="border-t border-border px-4 py-4" data-testid="settings-device-copy">
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
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Cópia</dt><dd className="font-medium">{status.isPending ? "…" : since(status.data?.fetchedAt ?? null)}</dd></div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Conferência com o servidor</dt>
          <dd className="text-right font-medium">
            {!report || report.checked === 0 ? "ainda sem telas conferidas"
              : differences === 0 ? `${report.matched} de ${report.checked} telas iguais`
              : <span className="text-amber-600 dark:text-amber-400">{differences} {differences === 1 ? "diferença" : "diferenças"} em {report.checked} telas</span>}
          </dd>
        </div>
        {differences > 0 ? <p className="pt-1 text-muted-foreground">Os números que você vê continuam vindo do servidor; as diferenças só servem para conferir a cópia.</p> : null}
      </dl>
    </div>
  );
}
