import { useEffect, useState } from "react";
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
  const [pulse, setPulse] = useState(false);
  const refresh = async () => setPending((await listSyncOperations()).length);

  useEffect(() => {
    void refresh();
    const syncState = () => void refresh();
    const syncSuccess = (event: Event) => {
      const op = (event as CustomEvent<{ operation: SyncOperation }>).detail.operation;
      toast.success("Sincronizado", {
        description: `Registro de ${new Date(op.createdAt).toLocaleString("pt-BR")} salvo na sua conta FINNOS.`,
        duration: 3500,
      });
    };
    const syncError = (event: Event) => {
      const op = (event as CustomEvent<{ operation: SyncOperation }>).detail.operation;
      toast.error("Não foi possível sincronizar", {
        description: `O registro continua salvo neste aparelho. Primeira tentativa: ${new Date(op.createdAt).toLocaleString("pt-BR")}.`,
        duration: 6500,
        action: { label: "Revisar", onClick: () => openTransaction({ syncOperationId: op.id, syncPayload: op.payload, firstAttemptAt: op.createdAt }) },
      });
    };
    const offline = () => {
      setState("offline");
      setSyncing(false);
      setPulse(true);
      window.setTimeout(() => setPulse(false), 2200);
      toast.warning("Você está offline", {
        description: "Os dados disponíveis neste aparelho continuam funcionando.",
        id: "finnos-offline",
        duration: 3500,
      });
    };
    const online = async () => {
      setState("online");
      setExpanded(false);
      setSyncing(true);
      toast.dismiss("finnos-offline");
      try {
        await flushSyncQueue();
        toast.success("Conexão restabelecida", {
          description: "O FINNOS voltou a ficar online.",
          id: "finnos-online",
          duration: 3000,
        });
      } finally {
        setSyncing(false);
        await refresh();
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void online();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    window.addEventListener("finnos:sync-state", syncState);
    window.addEventListener("finnos:sync-success", syncSuccess);
    window.addEventListener("finnos:sync-error", syncError);
    document.addEventListener("visibilitychange", visible);
    if (!navigator.onLine) offline();
    else void flushSyncQueue().finally(refresh);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      window.removeEventListener("finnos:sync-state", syncState);
      window.removeEventListener("finnos:sync-success", syncSuccess);
      window.removeEventListener("finnos:sync-error", syncError);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [openTransaction]);

  if (state === "online" && pending === 0 && !syncing) return null;

  const label = syncing ? "Sincronizando…" : state === "offline"
    ? (pending ? `${pending} pendente${pending > 1 ? "s" : ""}` : "Sem conexão")
    : `${pending} aguardando`;

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className={cn(
        "fixed left-1/2 top-[calc(env(safe-area-inset-top)+4.5rem)] z-[70] flex -translate-x-1/2 items-center overflow-hidden rounded-full border bg-background/90 text-xs font-medium text-foreground shadow-md backdrop-blur-xl transition-all duration-500",
        expanded ? "max-w-[88vw] gap-2 px-3 py-2" : "h-10 max-w-[11rem] gap-2 px-3",
        state === "offline" ? "border-amber-500/35" : "border-primary/25",
        pulse && "scale-105",
      )}
      role="status"
      aria-live="polite"
      aria-expanded={expanded}
      data-testid="offline-status"
    >
      <span className="relative grid size-5 shrink-0 place-items-center">
        {syncing ? <Loader2 className="size-4 animate-spin text-primary" /> :
          state === "offline" ? <CloudOff className="size-4 text-amber-500 animate-[pulse_1.8s_ease-in-out_infinite]" /> :
          <Cloud className="size-4 text-primary" />}
      </span>
      <span className={cn("whitespace-nowrap transition-all duration-500", !expanded && state === "offline" && "animate-[pulse_2.4s_ease-in-out_infinite]")}>
        {expanded && state === "offline"
          ? (pending ? `Sem conexão · ${pending} lançamento${pending > 1 ? "s" : ""} aguardando sincronização` : "Sem conexão · usando os dados salvos neste aparelho")
          : label}
      </span>
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
