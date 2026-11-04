import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import { Cloud, CloudOff, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { flushSyncQueue, listSyncOperations, type SyncOperation } from "@/lib/sync/queue";
import { describeSyncQueue } from "@/lib/sync/presentation";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { SyncEntityReviewDialog } from "./SyncEntityReviewDialog";
import type { TransactionInput } from "@/types/finnos";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type NetworkState = "online" | "offline";

export function ConnectivityStatus() {
  const { openTransaction } = useDialogs();
  const [state, setState] = useState<NetworkState>(() => navigator.onLine ? "online" : "offline");
  const [operations, setOperations] = useState<SyncOperation[]>([]);
  const [reviewEntity, setReviewEntity] = useState<SyncOperation | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const collapseTimer = useRef<number | null>(null);
  const pending = operations.length;
  const presentation = describeSyncQueue(operations, state, syncing);
  const blocker = presentation.blocker;

  const collapseLater = useCallback((delay = 4200) => {
    if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
    collapseTimer.current = window.setTimeout(() => setExpanded(false), delay);
  }, []);

  const refresh = useCallback(async () => {
    const operations = await listSyncOperations();
    setOperations(operations);
    return operations;
  }, []);

  const runSync = useCallback(async (announceReconnect = false) => {
    if (!navigator.onLine) return;
    setState("online");
    const syncUid = firebaseAuth?.currentUser?.uid;
    if (!syncUid) {
      setOperations([]);
      setSyncing(false);
      setExpanded(false);
      return;
    }
    const before = await listSyncOperations();
    if (before.length === 0) {
      setOperations([]);
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

    setOperations(before);
    setSyncing(true);
    setExpanded(true);
    if (announceReconnect) {
      toast.success("Conexão restabelecida", {
        description: "O FINNOS tentará enviar os registros pendentes ao servidor.",
        duration: 3200,
      });
    }

    try {
      await flushSyncQueue();
      // A late HTTP acknowledgement from another login must not be shown
      // as this user\'s successful synchronization.
      if (syncUid !== firebaseAuth?.currentUser?.uid) {
        await refresh();
        return;
      }
      const after = await refresh();
      if (after.length === 0) {
        toast.success("Sincronização concluída", {
          description: "Todos os dados pendentes foram sincronizados com sua conta FINNOS.",
          duration: 3500,
        });
        setExpanded(false);
      } else {
        // A rejected operation intentionally blocks the whole FIFO queue.
        // Keep its status visible until the user explicitly reviews it.
        setExpanded(after.some(op => op.status === "conflict"));
      }
    } catch {
      await refresh();
      toast.error("Não foi possível verificar a sincronização. Os registros locais foram preservados.");
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  useEffect(() => {
    const syncState = () => void refresh();
    const syncSuccess = () => { void queryClient.invalidateQueries(); void refresh(); };
    const syncError = (event: Event) => {
      const op = (event as CustomEvent<{ operation: SyncOperation }>).detail.operation;
      setExpanded(op.status === "conflict");
      toast.error(op.status === "conflict" ? "Sincronização exige revisão" : "Não foi possível sincronizar", {
        description: op.status === "conflict"
          ? "Este registro foi rejeitado. Os seguintes estão protegidos até a revisão."
          : "O registro continua salvo neste aparelho e poderá ser revisado.",
        duration: 5000,
        action: { label: "Revisar", onClick: () => {
          if (op.kind.startsWith("transaction.")) {
            openTransaction({ syncOperationId: op.id, syncPayload: op.payload as TransactionInput, firstAttemptAt: op.createdAt });
          } else {
            setReviewEntity(op);
          }
        } },
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
    window.addEventListener("finnos:sync-success", syncSuccess);
    window.addEventListener("finnos:sync-error", syncError);
    document.addEventListener("visibilitychange", visible);

    const stopAuth = firebaseAuth
      ? onAuthStateChanged(firebaseAuth, () => {
          // Never retain another UID\'s pending record in an on-screen dialog.
          setReviewEntity(null);
          setOperations([]);
          if (navigator.onLine) void runSync(false);
          else void refresh();
        })
      : () => {};
    if (!navigator.onLine) offline();
    else void runSync(false);

    return () => {
      stopAuth();
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      window.removeEventListener("finnos:sync-state", syncState);
      window.removeEventListener("finnos:sync-success", syncSuccess);
      window.removeEventListener("finnos:sync-error", syncError);
      document.removeEventListener("visibilitychange", visible);
      if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
    };
  }, [collapseLater, openTransaction, refresh, runSync]);

  if (state === "online" && pending === 0 && !syncing && !reviewEntity) return null;

  const expand = () => {
    setExpanded(true);
    if (!blocker) collapseLater(5000);
  };

  const reviewBlocker = () => {
    if (!blocker) return expand();
    if (!blocker.kind.startsWith("transaction.")) {
      setReviewEntity(blocker);
      return;
    }
    openTransaction({
      syncOperationId: blocker.id,
      syncPayload: blocker.payload as TransactionInput,
      firstAttemptAt: blocker.createdAt,
    });
  };

  return (
    <>
    <button
      type="button"
      onClick={blocker ? reviewBlocker : expanded ? () => setExpanded(false) : expand}
      className={cn(
        "fixed left-1/2 top-[calc(env(safe-area-inset-top)+4.5rem)] z-[70] flex -translate-x-1/2 select-none items-center justify-center overflow-hidden rounded-full border bg-background/92 text-xs font-medium text-foreground shadow-md backdrop-blur-xl transition-[width,padding,transform,opacity] duration-300 touch-manipulation",
        expanded ? "w-auto max-w-[calc(100vw-2rem)] gap-2 px-4 py-2.5" : "size-10 p-0",
        state === "offline" || blocker ? "border-amber-500/35" : "border-primary/25",
      )}
      role="status"
      aria-live="polite"
      aria-expanded={expanded}
      aria-label={presentation.ariaLabel}
      data-testid="offline-status"
    >
      <span className="grid size-5 shrink-0 place-items-center">
        {syncing ? <Loader2 className="size-4 animate-spin text-primary" /> :
          blocker ? <TriangleAlert className="size-4 text-amber-500" /> :
          state === "offline" ? <CloudOff className="size-4 text-amber-500" /> :
          <Cloud className="size-4 text-primary" />}
      </span>
      {expanded && (
        <span className="min-w-0 whitespace-normal text-left leading-snug">
          {presentation.text}
        </span>
      )}
    </button>
    <SyncEntityReviewDialog operation={reviewEntity} onClose={() => { setReviewEntity(null); void refresh(); }} />
    </>
  );
}

export function SyncStateLabel({ pending = 0, syncing = false, error = false }: { pending?: number; syncing?: boolean; error?: boolean }) {
  if (error) return <span className="inline-flex items-center gap-1 text-xs text-destructive"><TriangleAlert className="size-3.5" /> Falha ao sincronizar</span>;
  if (syncing) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Sincronizando…</span>;
  if (!navigator.onLine) return <span className="inline-flex items-center gap-1 text-xs text-amber-500"><CloudOff className="size-3.5" /> {pending ? `${pending} aguardando sincronização` : "Offline"}</span>;
  if (pending) return <span className="inline-flex items-center gap-1 text-xs text-amber-500"><Cloud className="size-3.5" /> {pending} aguardando sincronização</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Cloud className="size-3.5" /> Tudo sincronizado</span>;
}
