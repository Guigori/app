import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { cacheSavedAt } from "@/lib/offline/accountCache";
import { isLocalMode } from "@/lib/mode";

/** Offline snapshot notice: never presents cached financial data as live. */
export function OfflineSnapshotNotice({ cacheKeys }: { cacheKeys: string[] }) {
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const keys = cacheKeys.join("|");

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (!offline || isLocalMode()) return;
    let cancelled = false;
    void Promise.all(keys.split("|").map((key) => cacheSavedAt(key).catch(() => null))).then((times) => {
      if (!cancelled) setLastSaved(times.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null);
    });
    return () => { cancelled = true; };
  }, [offline, keys]);

  if (!offline || isLocalMode()) return null;
  const formatted = lastSaved
    ? new Date(lastSaved).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : null;
  return (
    <div role="status" className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/[.055] p-4 text-sm">
      <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div>
        <p className="font-semibold">Você está offline</p>
        <p className="text-muted-foreground">
          {formatted ? `Exibindo dados salvos neste aparelho. Última atualização: ${formatted}.` :
            "Somente dados já armazenados neste aparelho estarão disponíveis."}
          {" "}Novos lançamentos serão enviados quando a conexão voltar.
        </p>
      </div>
    </div>
  );
}
