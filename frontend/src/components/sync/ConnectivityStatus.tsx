import { useEffect, useState } from "react";
import { Cloud, CloudOff, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

type NetworkState = "online" | "offline";

export function ConnectivityStatus() {
  const [state, setState] = useState<NetworkState>(() => navigator.onLine ? "online" : "offline");
  const [reconnected, setReconnected] = useState(false);

  useEffect(() => {
    const offline = () => {
      setState("offline");
      setReconnected(false);
      toast.warning("Você está offline", {
        description: "O FINNOS continuará usando os dados disponíveis neste aparelho.",
        id: "finnos-offline",
        duration: Infinity,
      });
    };
    const online = () => {
      setState("online");
      toast.dismiss("finnos-offline");
      setReconnected(true);
      toast.success("Conexão restabelecida", {
        description: "O FINNOS voltou a ficar online.",
        id: "finnos-online",
        duration: 3500,
      });
      window.setTimeout(() => setReconnected(false), 4000);
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    if (!navigator.onLine) offline();
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);

  if (state === "offline") {
    return (
      <div className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+4.5rem)] z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-500/30 bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur-md" role="status" aria-live="polite" data-testid="offline-status">
        <CloudOff className="size-3.5 text-amber-500" />
        Sem conexão
      </div>
    );
  }

  if (reconnected) {
    return (
      <div className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+4.5rem)] z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border border-emerald-500/30 bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur-md" role="status" aria-live="polite">
        <Cloud className="size-3.5 text-emerald-500" />
        Online
      </div>
    );
  }

  return null;
}

export function SyncStateLabel({ pending = 0, syncing = false, error = false }: { pending?: number; syncing?: boolean; error?: boolean }) {
  if (error) return <span className="inline-flex items-center gap-1 text-xs text-destructive"><TriangleAlert className="size-3.5" /> Falha ao sincronizar</span>;
  if (syncing) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Sincronizando…</span>;
  if (!navigator.onLine) return <span className="inline-flex items-center gap-1 text-xs text-amber-500"><CloudOff className="size-3.5" /> {pending ? `${pending} aguardando sincronização` : "Offline"}</span>;
  if (pending) return <span className="inline-flex items-center gap-1 text-xs text-amber-500"><Cloud className="size-3.5" /> {pending} aguardando sincronização</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Cloud className="size-3.5" /> Tudo sincronizado</span>;
}
