import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";
import { clearQuotaBlock, useQuotaBlock } from "@/lib/quota";
import { queryClient } from "@/lib/queryClient";
import { listSyncOperations } from "@/lib/sync/queue";

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Shown while the database's daily limit pauses synchronisation (lib/quota.ts): the app keeps working with this
 *  device's data and queues new records; when it reopens, everything reloads and the queue is sent. */
export function QuotaBanner() {
  const { until } = useQuotaBlock();
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    if (!until) return;
    const count = () => void listSyncOperations().then((ops) => setWaiting(ops.length)).catch(() => undefined);
    count();
    window.addEventListener("finnos:sync-state", count);
    const wait = Math.max(0, until - Date.now()) + 30_000;
    const timer = window.setTimeout(() => {
      clearQuotaBlock();
      void queryClient.invalidateQueries();
    }, Math.min(wait, 2_147_000_000));
    return () => { window.clearTimeout(timer); window.removeEventListener("finnos:sync-state", count); };
  }, [until]);

  if (!until) return null;
  return (
    <div role="status" data-testid="quota-banner"
      className="mb-4 flex items-center gap-2.5 rounded-2xl border border-amber-300/50 bg-amber-50/80 px-3.5 py-2 text-xs text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
      <CloudOff className="size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 leading-snug">
        <span className="font-semibold">Sincronização pausada até {clock(until)}</span>
        <span className="text-amber-800/80 dark:text-amber-200/75">
          {" · "}usando os dados deste aparelho
          {waiting ? ` · ${waiting} ${waiting === 1 ? "registro aguardando envio" : "registros aguardando envio"}` : ""}
        </span>
      </p>
    </div>
  );
}
