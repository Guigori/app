import { useEffect } from "react";
import { DatabaseZap } from "lucide-react";
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
      className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <DatabaseZap className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold">O limite diário do banco de dados foi atingido.</span>{" "}
        {stale ? "Você está vendo os últimos dados salvos neste aparelho, que podem estar desatualizados. " : "Alguns dados não vão carregar agora. "}
        Tudo volta sozinho às {clock(until)}; novos registros só podem ser salvos depois disso.
      </p>
    </div>
  );
}
