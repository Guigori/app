/** Beta admin: who asked for an invite, who is in, what people wrote and which errors the app hit.
 *  Only e-mails in ADMIN_EMAILS can open it; for anyone else the API answers 404. */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bug, Check, Copy, Lightbulb, Loader2, Mail, MessageCircle, Phone, Smile, Trash2, UserPlus } from "lucide-react";
import { ScreenHeader } from "@/components/layout/BackButton";
import { ApiError } from "@/lib/api";
import {
  fetchAdminOverview, grantAccess, inviteMessage, revokeAccess, setAdminStatus,
  type AdminOverview, type ErrorRow, type FeedbackRow, type WaitlistRow,
} from "@/lib/beta";
import { getApiErrorMessage } from "@/lib/errors";

type Tab = "interessados" | "liberados" | "feedback" | "erros";

const when = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};
const phoneOut = (p: string) => p.length === 11 ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}` : p;

async function copy(text: string, label: string) {
  try { await navigator.clipboard.writeText(text); toast.success(label); } catch { toast.error("Não deu para copiar."); }
}

function Pill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "good" | "warn" | "bad" }) {
  const tones = { muted: "bg-muted text-muted-foreground", good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", warn: "bg-amber-500/10 text-amber-700 dark:text-amber-300", bad: "bg-rose-500/10 text-rose-700 dark:text-rose-300" };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

function WaitlistItem({ row, onInvite, busy }: { row: WaitlistRow; onInvite: (row: WaitlistRow) => void; busy: boolean }) {
  const released = row.status === "liberado";
  const wa = `https://wa.me/55${row.phone}?text=${encodeURIComponent(inviteMessage(row.name))}`;
  return (
    <li className="rounded-2xl border border-border bg-card p-4" data-testid="admin-waitlist-row">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{row.name}</p>
          <p className="truncate text-sm text-muted-foreground">{row.email}</p>
          <p className="text-sm text-muted-foreground">{phoneOut(row.phone)} · {when(row.created_at)}{row.source ? ` · ${row.source}` : ""}</p>
        </div>
        {released ? <Pill tone="good">Liberado</Pill> : <Pill>Aguardando</Pill>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {!released ? (
          <button type="button" disabled={busy} onClick={() => onInvite(row)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60" data-testid="admin-invite">
            <UserPlus className="h-4 w-4" /> Liberar acesso
          </button>
        ) : null}
        <button type="button" onClick={() => copy(inviteMessage(row.name), "Mensagem de convite copiada.")} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium"><Copy className="h-4 w-4" /> Copiar convite</button>
        <a href={`mailto:${row.email}?subject=${encodeURIComponent("Seu acesso ao FINNOS foi liberado")}&body=${encodeURIComponent(inviteMessage(row.name))}`} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium"><Mail className="h-4 w-4" /> E-mail</a>
        <a href={wa} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium"><Phone className="h-4 w-4" /> WhatsApp</a>
      </div>
    </li>
  );
}

const KIND: Record<FeedbackRow["kind"], { label: string; icon: typeof Bug }> = {
  bug: { label: "Problema", icon: Bug }, ideia: { label: "Ideia", icon: Lightbulb }, elogio: { label: "Elogio", icon: Smile },
  duvida: { label: "Dúvida", icon: MessageCircle }, outro: { label: "Outro", icon: MessageCircle },
};

function FeedbackItem({ row, onStatus }: { row: FeedbackRow; onStatus: (status: string) => void }) {
  const { label, icon: Icon } = KIND[row.kind] ?? KIND.outro;
  const done = row.status === "resolvido";
  return (
    <li className={`rounded-2xl border border-border bg-card p-4 ${done ? "opacity-60" : ""}`} data-testid="admin-feedback-row">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold"><Icon className="h-4 w-4 text-primary" /> {label}{row.mood ? <span className="text-muted-foreground"> · nota {row.mood}/5</span> : null}</span>
        <span className="text-xs text-muted-foreground">{when(row.created_at)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{row.message}</p>
      <p className="mt-2 text-xs text-muted-foreground">{row.email} · {row.screen || "—"} · {row.device || ""} · v{row.version || "?"}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => onStatus(done ? "novo" : "resolvido")} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold"><Check className="h-3.5 w-3.5" /> {done ? "Reabrir" : "Resolvido"}</button>
        {row.email ? <a href={`mailto:${row.email}?subject=${encodeURIComponent("Sobre seu feedback no FINNOS")}`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold"><Mail className="h-3.5 w-3.5" /> Responder</a> : null}
      </div>
    </li>
  );
}

function ErrorItem({ row, onStatus }: { row: ErrorRow; onStatus: (status: string) => void }) {
  const [open, setOpen] = useState(false);
  const done = row.status === "resolvido" || row.status === "ignorado";
  return (
    <li className={`rounded-2xl border border-border bg-card p-4 ${done ? "opacity-60" : ""}`} data-testid="admin-error-row">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words font-mono text-[13px] font-semibold">{row.message}</p>
        <Pill tone={done ? "muted" : row.user_count > 1 ? "bad" : "warn"}>{row.count}× · {row.user_count} pessoa{row.user_count === 1 ? "" : "s"}</Pill>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">Última vez {when(row.last_seen)} em {row.last_screen || "—"} · v{row.version || "?"} · {row.device || ""}</p>
      {row.stack ? (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 text-xs font-semibold text-primary">{open ? "Esconder detalhes" : "Ver detalhes"}</button>
          {open ? <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-muted p-3 text-[11px] leading-snug">{row.stack}</pre> : null}
        </>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => onStatus(done ? "aberto" : "resolvido")} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold"><Check className="h-3.5 w-3.5" /> {done ? "Reabrir" : "Corrigido"}</button>
        {!done ? <button type="button" onClick={() => onStatus("ignorado")} className="inline-flex h-8 items-center rounded-full border border-border px-3 text-xs font-semibold">Ignorar</button> : null}
      </div>
    </li>
  );
}

export default function Admin() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("interessados");
  const [email, setEmail] = useState("");
  const overview = useQuery({ queryKey: ["admin-overview"], queryFn: fetchAdminOverview, retry: false, staleTime: 30_000 });
  const data = overview.data;

  const invite = useMutation({
    mutationFn: ({ email, name }: { email: string; name?: string }) => grantAccess(email, name),
    onSuccess: async (res) => {
      setEmail("");
      await qc.invalidateQueries({ queryKey: ["admin-overview"] });
      void copy(inviteMessage(res.name), "Acesso liberado. Mensagem de convite copiada.");
    },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });
  const revoke = useMutation({
    mutationFn: revokeAccess,
    onSuccess: () => { toast.success("Acesso removido."); void qc.invalidateQueries({ queryKey: ["admin-overview"] }); },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });
  const status = useMutation({
    mutationFn: ({ kind, id, value }: { kind: "feedback" | "errors"; id: string; value: string }) => setAdminStatus(kind, id, value),
    onMutate: ({ kind, id, value }) => {
      qc.setQueryData<AdminOverview>(["admin-overview"], (old) => old && ({ ...old, [kind]: (old[kind] as Array<{ id: string }>).map((r) => r.id === id ? { ...r, status: value } : r) }));
    },
  });

  const counts = useMemo(() => ({
    interessados: data?.waitlist.filter((r) => r.status !== "liberado").length ?? 0,
    liberados: data?.access.length ?? 0,
    feedback: data?.feedback.filter((r) => r.status !== "resolvido").length ?? 0,
    erros: data?.errors.filter((r) => r.status === "aberto").length ?? 0,
  }), [data]);

  if (overview.error instanceof ApiError && overview.error.status === 404) {
    return <div className="mx-auto max-w-md px-6 py-20 text-center"><p className="font-semibold">Esta área é só para quem administra o beta.</p></div>;
  }

  const tabs: Array<[Tab, string]> = [["interessados", "Pedidos"], ["liberados", "Liberados"], ["feedback", "Feedback"], ["erros", "Erros"]];
  const waiting = (data?.waitlist ?? []).slice().sort((a, b) => Number(a.status === "liberado") - Number(b.status === "liberado"));

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-40 animate-fade-up" data-testid="admin-page">
      <ScreenHeader title="Beta" subtitle={data ? (data.invite_only ? "Entrada só por convite está ligada." : "Entrada por convite está desligada: qualquer conta entra.") : "Convites, feedback e erros"} keepSubtitle />
      <div role="tablist" className="grid grid-cols-4 gap-1 rounded-full bg-muted p-1">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)} className={`flex min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-full px-1 py-2 text-[13px] sm:text-sm font-semibold transition ${tab === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`} data-testid={`admin-tab-${id}`}>
            {label}{counts[id] ? <span className="rounded-full bg-primary px-1.5 text-[11px] leading-5 text-primary-foreground">{counts[id]}</span> : null}
          </button>
        ))}
      </div>

      {overview.isPending ? <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : null}
      {overview.isError && !(overview.error instanceof ApiError && overview.error.status === 404) ? <p className="text-sm text-destructive">{getApiErrorMessage(overview.error, "Não deu para carregar o painel.")}</p> : null}

      {data && tab === "interessados" ? (
        waiting.length ? <ul className="space-y-3">{waiting.map((row) => <WaitlistItem key={row.id} row={row} busy={invite.isPending} onInvite={(r) => invite.mutate({ email: r.email, name: r.name })} />)}</ul>
          : <p className="py-10 text-center text-sm text-muted-foreground">Ninguém pediu convite ainda. Compartilhe o link {window.location.origin}/bem-vindo.</p>
      ) : null}

      {data && tab === "liberados" ? (
        <>
          <form onSubmit={(e) => { e.preventDefault(); if (email.trim()) invite.mutate({ email: email.trim() }); }} className="flex gap-2">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Liberar um e-mail direto" className="h-11 min-w-0 flex-1 rounded-full border border-border bg-card px-4 text-sm" data-testid="admin-grant-email" />
            <button type="submit" disabled={invite.isPending} className="h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">Liberar</button>
          </form>
          {data.access.length ? (
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
              {data.access.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid="admin-access-row">
                  <div className="min-w-0"><p className="truncate font-medium">{row.name || row.email}</p><p className="truncate text-xs text-muted-foreground">{row.name ? `${row.email} · ` : ""}{when(row.created_at)}</p></div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" aria-label="Copiar convite" onClick={() => copy(inviteMessage(row.name), "Mensagem de convite copiada.")} className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"><Copy className="h-4 w-4" /></button>
                    <button type="button" aria-label="Remover acesso" onClick={() => { if (window.confirm(`Remover o acesso de ${row.email}?`)) revoke.mutate(row.id); }} className="grid h-9 w-9 place-items-center rounded-full text-rose-600 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="py-6 text-center text-sm text-muted-foreground">Nenhum e-mail liberado ainda. Quem já usa o FINNOS continua entrando normalmente.</p>}
        </>
      ) : null}

      {data && tab === "feedback" ? (
        data.feedback.length ? <ul className="space-y-3">{data.feedback.map((row) => <FeedbackItem key={row.id} row={row} onStatus={(value) => status.mutate({ kind: "feedback", id: row.id, value })} />)}</ul>
          : <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>
      ) : null}

      {data && tab === "erros" ? (
        data.errors.length ? <ul className="space-y-3">{data.errors.map((row) => <ErrorItem key={row.id} row={row} onStatus={(value) => status.mutate({ kind: "errors", id: row.id, value })} />)}</ul>
          : <p className="py-10 text-center text-sm text-muted-foreground">Nenhum erro registrado no app.</p>
      ) : null}
    </div>
  );
}
