import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Copy, Download, Loader2, Plus, Trash2, XCircle } from "lucide-react";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ShortcutToken { id: string; label: string; hint: string; created_at: string; last_used_at: string | null }
interface Activity { at: string; action: string; ok: boolean; mensagem: string }

/** The signed ready-made shortcut (scripts/build_shortcut.py). It asks for the connection code when added. */
const READY_SHORTCUT = "/atalhos/registrar-no-finnos.shortcut";

async function copy(value: string, done = "Copiado.") {
  try { await navigator.clipboard.writeText(value); toast.success(done); } catch { toast.error("Não consegui copiar. Selecione e copie o texto."); }
}

function Code({ value }: { value: string }) {
  return (
    <span className="mt-1 flex items-center gap-2 rounded-xl bg-muted px-3 py-2">
      <code className="min-w-0 flex-1 break-all text-xs">{value}</code>
      <button type="button" onClick={() => void copy(value)} aria-label="Copiar" className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-background"><Copy className="h-4 w-4" aria-hidden="true" /></button>
    </span>
  );
}

/**
 * Registrar pelo iPhone sem abrir o FINNOS: a personal code for the Atalhos app, the shortcut
 * recipe (the same one the ready-made shortcut follows) and what each code has been doing.
 */
export function ShortcutConnect() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("iPhone");
  // "address|code": the one thing the ready-made shortcut asks for, so it works on any domain.
  const [fresh, setFresh] = useState<string | null>(null);
  const api = `${window.location.origin}/api/shortcuts`;
  const addToShortcuts = () => { if (fresh) void copy(fresh, "Código copiado. Cole quando o Atalhos pedir."); };

  const list = useQuery({ queryKey: ["shortcut-tokens"], queryFn: () => apiGet<ShortcutToken[]>("/integrations/shortcut-tokens") });
  const activity = useQuery({ queryKey: ["shortcut-activity"], queryFn: () => apiGet<Activity[]>("/integrations/shortcut-activity") });
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["shortcut-tokens"] }), queryClient.invalidateQueries({ queryKey: ["shortcut-activity"] })]);

  const create = useMutation({
    mutationFn: () => apiPost<ShortcutToken & { token: string }>("/integrations/shortcut-tokens", { label: label.trim() || "iPhone" }),
    onSuccess: async (data) => { setFresh(`${window.location.origin}|${data.token}`); await refresh(); },
    onError: (error) => toast.error(getApiErrorMessage(error, "Não foi possível gerar o código agora.")),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiDelete(`/integrations/shortcut-tokens/${encodeURIComponent(id)}`),
    onSuccess: async () => { toast.success("Atalho desconectado. O código parou de funcionar."); await refresh(); },
    onError: (error) => toast.error(getApiErrorMessage(error, "Não foi possível desconectar agora.")),
  });

  const tokens = list.data ?? [];
  const step = (n: number, body: ReactNode) => (
    <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">{n}</span><span className="min-w-0 flex-1">{body}</span></li>
  );

  return (
    <div className="space-y-5 text-sm" data-testid="shortcut-connect">
      <section className="space-y-2">
        <h3 className="font-semibold">1. Gere o código de conexão</h3>
        <p className="text-muted-foreground">O código só serve para listar suas contas, cartões e categorias e para criar lançamentos. Ele não abre o resto da sua conta e pode ser desconectado a qualquer momento.</p>
        {fresh ? (
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3" data-testid="shortcut-fresh-token">
            <p className="font-semibold">Guarde até colar no Atalhos: ele não aparece de novo.</p>
            <Code value={fresh} />
          </div>
        ) : (
          <div className="flex gap-2">
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} aria-label="Nome do aparelho" className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3" />
            <button type="button" onClick={() => create.mutate()} disabled={create.isPending} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 font-semibold text-primary-foreground disabled:opacity-60" data-testid="shortcut-create-token">
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}Gerar código
            </button>
          </div>
        )}
        {tokens.length ? (
          <ul className="divide-y divide-border rounded-2xl border border-border" data-testid="shortcut-tokens">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1"><span className="block font-medium">{t.label} <span className="text-xs text-muted-foreground">•••• {t.hint}</span></span><span className="block text-xs text-muted-foreground">{t.last_used_at ? `Usado em ${formatDate(t.last_used_at.slice(0, 10))}` : "Ainda não usado"}</span></span>
                <button type="button" onClick={() => revoke.mutate(t.id)} disabled={revoke.isPending} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-expense"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Desconectar</button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">2. Adicione o atalho pronto</h3>
        <a href={READY_SHORTCUT} download="Registrar no FINNOS.shortcut" onClick={addToShortcuts} aria-disabled={!fresh}
          className={cn("flex h-12 items-center justify-center gap-2 rounded-2xl font-semibold", fresh ? "bg-primary text-primary-foreground" : "pointer-events-none bg-muted text-muted-foreground")} data-testid="shortcut-ready">
          <Download className="h-5 w-5" aria-hidden="true" />Adicionar ao Atalhos
        </a>
        <p className="text-muted-foreground">{fresh ? "O código já vai copiado. No iPhone, toque em Adicionar Atalho e cole o código quando ele pedir. Pronto: rode pela Siri (\"Registrar no FINNOS\"), pela tela de início ou pelo botão de Ação." : "Gere o código primeiro: o atalho pede por ele ao ser adicionado."}</p>
        <details className="rounded-2xl border border-border p-3">
          <summary className="cursor-pointer font-medium">Ou monte você mesmo (uns 5 minutos)</summary>
          <ol className="mt-3 space-y-3">
            {step(1, <>Novo atalho → <strong>Obter Conteúdo do URL</strong>, com o endereço abaixo. Em <em>Cabeçalhos</em>, adicione <strong>Authorization</strong> com o valor <strong>Bearer</strong>, um espaço e o código (a parte que começa com fns_).<Code value={`${api}/opcoes`} /></>)}
            {step(2, <><strong>Pedir Entrada</strong> (Número): "Quanto foi?"</>)}
            {step(3, <>Para cada lista, use <strong>Obter Valor do Dicionário</strong> do resultado do passo 1 e depois <strong>Escolher da Lista</strong>: <code>tipos</code> (Despesa ou Receita), <code>formas</code> (Pix, Débito, Dinheiro, Vale, Crédito), <code>carteiras</code> (contas e cartões) e <code>categorias</code>.</>)}
            {step(4, <><strong>Pedir Entrada</strong> (Número): "Em quantas parcelas?", com 1 como padrão. Só vale no crédito.</>)}
            {step(5, <>Outro <strong>Obter Conteúdo do URL</strong>, método <strong>POST</strong>, o mesmo cabeçalho e <em>Corpo da Solicitação</em> JSON com <code>valor</code>, <code>tipo</code>, <code>forma</code>, <code>carteira</code>, <code>categoria</code> e <code>parcelas</code> (e, se quiser, <code>descricao</code>):<Code value={`${api}/lancamentos`} /></>)}
            {step(6, <><strong>Obter Valor do Dicionário</strong> <code>mensagem</code> e <strong>Mostrar Notificação</strong>. Aparece "Registrado no FINNOS: …" ou o que precisa corrigir.</>)}
            {step(7, <>Dê o nome <strong>Registrar no FINNOS</strong>. Rode pela Siri, pela tela de início, pelo widget ou pelo botão de Ação do iPhone.</>)}
          </ol>
        </details>
        <details className="rounded-2xl border border-border p-3">
          <summary className="cursor-pointer font-medium">A cada compra com Apple Pay, sem abrir o app</summary>
          <ol className="mt-3 space-y-3">
            {step(1, <>Em <strong>Automação</strong> → <strong>Transação</strong>, escolha os cartões e marque <strong>Executar Imediatamente</strong>.</>)}
            {step(2, <><strong>Obter Conteúdo do URL</strong> (POST, mesmo cabeçalho) para o endereço de lançamentos, com JSON <code>valor</code> = <em>Valor</em>, <code>descricao</code> = <em>Comerciante</em> e <code>carteira</code> = <em>Cartão ou Passe</em>.</>)}
            {step(3, <><strong>Mostrar Notificação</strong> com <code>mensagem</code>. A categoria vem do último lançamento com o mesmo nome; o nome do cartão na Carteira pode ser mais longo que o do FINNOS.</>)}
          </ol>
        </details>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Atividade recente</h3>
        {!activity.data?.length ? <p className="text-muted-foreground">Nenhum uso ainda.</p> : (
          <ul className="space-y-1.5" data-testid="shortcut-activity">
            {activity.data.slice(0, 8).map((a, i) => (
              <li key={`${a.at}-${i}`} className="flex items-start gap-2">
                {a.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-income" aria-hidden="true" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-expense" aria-hidden="true" />}
                <span className="min-w-0 flex-1"><span className="block">{a.mensagem}</span><span className="block text-xs text-muted-foreground">{a.at ? formatDate(String(a.at).slice(0, 10)) : ""}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
