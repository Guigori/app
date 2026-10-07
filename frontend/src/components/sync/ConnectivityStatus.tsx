import { useCallback, useEffect, useRef, useState } from "react";
import { Cloud, CloudOff, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { flushSyncQueue, listSyncOperations, type SyncOperation } from "@/lib/sync/queue";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { cn } from "@/lib/utils";

type NetworkState = "online" | "offline";

export function ConnectivityStatus() {
  const { openTransaction } = useDialogs();
  const [state, setState] = useState<NetworkState>(() => navigator.onLine ? "online" : "offline");
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const collapseTimer = useRef<number | null>(null);

  const collapseLater = useCallback((delay = 4200) => {
    if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
    collapseTimer.current = window.setTimeout(() => setExpanded(false), delay);
  }, []);

  const refresh = useCallback(async () => {
    const operations = await listSyncOperations();
    setPending(operations.length);
    return operations;
  }, []);

  const runSync = useCallback(async (announceReconnect = false) => {
    if (!navigator.onLine) return;
    setState("online");
    const before = await listSyncOperations();
    if (before.length === 0) {
      setPending(0);
      setSyncing(false);
      setExpanded(false);
      if (announceReconnect) {
        toast.success("Conexão restabelecida", {
          description: "O FINNOS voltou a ficar online.",
          duration: 3000,
        });
      }
      return;
    }

    setPending(before.length);
    setSyncing(true);
    setExpanded(true);
    if (announceReconnect) {
      toast.success("Conexão restabelecida", {
        description: "O FINNOS voltou a ficar online. Seus dados estão sendo sincronizados.",
        duration: 3200,
      });
    }

    try {
      await flushSyncQueue();
      const after = await refresh();
      if (after.length === 0) {
        toast.success("Sincronização concluída", {
          description: "Todos os dados pendentes foram sincronizados com sua conta FINNOS.",
          duration: 3500,
        });
        setExpanded(false);
      } else {
        setExpanded(false);
      }
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  useEffect(() => {
    const syncState = () => void refresh();
    const syncError = (event: Event) => {
      const op = (event as CustomEvent<{ operation: SyncOperation }>).detail.operation;
      setExpanded(false);
      toast.error("Não foi possível sincronizar", {
        description: "O registro continua salvo neste aparelho e poderá ser revisado.",
        duration: 5000,
        action: { label: "Revisar", onClick: () => openTransaction({ syncOperationId: op.id, syncPayload: op.payload, firstAttemptAt: op.createdAt }) },
      });
    };
    const offline = () => {
      setState("offline");
      setSyncing(false);
      setExpanded(true);
      collapseLater();
      void refresh();
    };
    const online = () => void runSync(true);
    const visible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void runSync(false);
    };

    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    window.addEventListener("finnos:sync-state", syncState);
    window.addEventListener("finnos:sync-error", syncError);
    document.addEventListener("visibilitychange", visible);

    if (!navigator.onLine) offline();
    else void runSync(false);

    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      window.removeEventListener("finnos:sync-state", syncState);
      window.removeEventListener("finnos:sync-error", syncError);
      document.removeEventListener("visibilitychange", visible);
      if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
    };
  }, [collapseLater, openTransaction, refresh, runSync]);

  if (state === "online" && pending === 0 && !syncing) return null;

  const expand = () => {
    setExpanded(true);
    collapseLater(5000);
  };

  return (
    <button
      type="button"
      onClick={expanded ? () => setExpanded(false) : expand}
      className={cn(
        "fixed left-1/2 top-[calc(env(safe-area-inset-top)+4.5rem)] z-[70] flex -translate-x-1/2 select-none items-center justify-center overflow-hidden rounded-full border bg-background/92 text-xs font-medium text-foreground shadow-md backdrop-blur-xl transition-[width,padding,transform,opacity] duration-300 touch-manipulation",
        expanded ? "w-auto max-w-[calc(100vw-2rem)] gap-2 px-4 py-2.5" : "size-10 p-0",
        state === "offline" ? "border-amber-500/35" : "border-primary/25",
      )}
      role="status"
      aria-live="polite"
      aria-expanded={expanded}
      aria-label={state === "offline" ? "Sem conexão" : syncing ? "Sincronizando" : "Sincronização pendente"}
      data-testid="offline-status"
    >
      <span className="grid size-5 shrink-0 place-items-center">
        {syncing ? <Loader2 className="size-4 animate-spin text-primary" /> :
          state === "offline" ? <CloudOff className="size-4 text-amber-500" /> :
          <Cloud className="size-4 text-primary" />}
      </span>
      {expanded && (
        <span className="min-w-0 whitespace-normal text-left leading-snug">
          {syncing
            ? `Sincronizando ${pending} lançamento${pending === 1 ? "" : "s"}…`
            : state === "offline"
              ? (pending
                ? `Você está offline · ${pending} lançamento${pending === 1 ? "" : "s"} salvo${pending === 1 ? "" : "s"} neste aparelho`
                : "Você está offline · os dados disponíveis neste aparelho continuam funcionando")
              : `${pending} lançamento${pending === 1 ? "" : "s"} aguardando sincronização`}
        </span>
      )}
    </button>
  );
}

export function SyncStateLabel({ pending = 0, syncing = false, error = false }: { pending?: number; syncing?: boolean; error?: boolean }) {
  if (error) return <span className="inline-flex items-center gap-1 text-xs text-destructive"><TriangleAlert className="size-3.5" /> Falha ao sincronizar</span>;
  if (syncing) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Sincronizando…</span>;
  if (!navigator.onLine) return <span className="inline-flex items-center gap-1 text-xs text-amber-500"><CloudOff className="size-3.5" /> {pending ? `${pending} aguardando sincronização` : "Offline"}</span>;
  if (pending) return <span className="inline-flex items-center gap-1 text-xs text-amber-500"><Cloud className="size-3.5" /> {pending} aguardando sincronização</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Cloud className="size-3.5" /> Tudo sincronizado</span>;
}
