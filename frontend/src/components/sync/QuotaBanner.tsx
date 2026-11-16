import { useEffect } from "react";
import { CloudOff } from "lucide-react";
import { clearQuotaBlock, useQuotaBlock } from "@/lib/quota";
import { queryClient } from "@/lib/queryClient";

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Shown while the database's daily limit is used up (lib/quota.ts); reloads everything when it reopens. */
export function QuotaBanner() {
  const { until, stale } = useQuotaBlock();

  useEffect(() => {
    if (!until) return;
    const wait = Math.max(0, until - Date.now()) + 30_000;
    const timer = window.setTimeout(() => {
      clearQuotaBlock();
      void queryClient.invalidateQueries();
    }, Math.min(wait, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [until]);

  if (!until) return null;
  return (
    <div role="status" data-testid="quota-banner"
      className="mb-4 flex items-start gap-2.5 rounded-2xl border border-amber-300/60 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold">Sincronização com a nuvem pausada até {clock(until)}.</span>{" "}
        {stale ? "Você está usando os dados salvos neste aparelho. " : "O FINNOS continua funcionando com os dados deste aparelho. "}
        O que você registrar agora fica guardado aqui e é enviado sozinho quando a sincronização voltar.
      </p>
    </div>
  );
}
