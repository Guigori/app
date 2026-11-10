import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, ChevronDown, CircleDashed, Copy, CreditCard, ExternalLink, Landmark, Loader2, Plus, ReceiptText, Smartphone, Sparkles, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { createTestCapture, fetchPendingSettings, savePendingSettings } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { AUTOMATION_FIELDS, bearerValue, codeFromConnection, pendingEndpoint, SHORTCUTS_APP } from "@/lib/shortcutLinks";
import { cn } from "@/lib/utils";
import {
  ApplePayFlow, MockAutomationTab, MockBody, MockNotification, MockTrigger, MockUrlAction, StepPicture,
} from "@/components/settings/ApplePayIllustrations";

interface ShortcutToken { id: string; label: string; hint: string; created_at: string; last_used_at: string | null }
interface Activity { at: string; action: string; ok: boolean; mensagem: string }

async function copy(value: string, done = "Copiado.") {
  try { await navigator.clipboard.writeText(value); toast.success(done); } catch { toast.error("Não consegui copiar. Selecione e copie o texto."); }
}

function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <span className="mt-1.5 flex items-center gap-2 rounded-xl bg-muted px-3 py-2">
      <code className="min-w-0 flex-1 break-all text-xs" aria-label={label}>{value}</code>
      <button type="button" onClick={() => void copy(value)} aria-label={`Copiar ${label}`} className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-background"><Copy className="h-4 w-4" aria-hidden="true" /></button>
    </span>
  );
}

function Switch({ on, label, disabled, onToggle, testId }: { on: boolean; label: string; disabled?: boolean; onToggle: () => void; testId: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onToggle} data-testid={testId}
      className={cn("relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60", on ? "bg-primary" : "bg-muted-foreground/30")}>
      <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", on ? "left-[1.375rem]" : "left-0.5")} />
    </button>
  );
}

function Step({ n, done, title, children }: { n: number; done?: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3" data-testid={`applepay-step-${n}`}>
      <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold", done ? "bg-income/15 text-income" : "bg-primary/10 text-primary")}>
        {done ? <CheckCircle2 className="size-4" aria-label="Feito" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5"><h3 className="font-semibold">{title}</h3>{children}</div>
    </li>
  );
}

/**
 * Apple Pay → FINNOS in one place. On top, whether it is working; then how purchases are treated
 * (débito by default, register automatically), the connected iPhones (with Desconectar), and the
 * setup on the iPhone, step by step, folded away once purchases are arriving.
 *
 * The automation itself cannot be handed over as a ready file: the iPhone only shares ordinary
 * shortcuts, not personal automations. That is why this guide exists.
 */
export function ApplePaySetup() {
  const queryClient = useQueryClient();
  const origin = window.location.origin;
  const endpoint = pendingEndpoint(origin);
  // "address|code", shown once when generated; the header needs only the code.
  const [fresh, setFresh] = useState<string | null>(null);
  const code = codeFromConnection(fresh);

  const tokens = useQuery({ queryKey: ["shortcut-tokens"], queryFn: () => apiGet<ShortcutToken[]>("/integrations/shortcut-tokens") });
  const activity = useQuery({ queryKey: ["shortcut-activity"], queryFn: () => apiGet<Activity[]>("/integrations/shortcut-activity"), refetchInterval: 15_000 });
  const settings = useQuery({ queryKey: ["pending-settings"], queryFn: fetchPendingSettings });

  const refreshCodes = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["shortcut-tokens"] }), queryClient.invalidateQueries({ queryKey: ["shortcut-activity"] })]);
  const create = useMutation({
    mutationFn: () => apiPost<ShortcutToken & { token: string }>("/integrations/shortcut-tokens", { label: "Apple Pay" }),
    onSuccess: async (data) => { setFresh(`${origin}|${data.token}`); await refreshCodes(); },
    onError: (error) => toast.error(getApiErrorMessage(error, "Não foi possível gerar o código agora.")),
  });
  const test = useMutation({
    mutationFn: createTestCapture,
    onSuccess: async () => { toast.success("Compra de teste criada. Ela aparece no topo do Início."); await queryClient.invalidateQueries({ queryKey: ["pending-captures"] }); },
    onError: (error) => toast.error(getApiErrorMessage(error, "Não foi possível criar o teste agora.")),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiDelete(`/integrations/shortcut-tokens/${encodeURIComponent(id)}`),
    onSuccess: async () => { setFresh(null); toast.success("iPhone desconectado. O código parou de funcionar."); await refreshCodes(); },
    onError: (error) => toast.error(getApiErrorMessage(error, "Não foi possível desconectar agora.")),
  });
  const hold = useMutation({
    mutationFn: (on: boolean) => savePendingSettings({ hold_unusual: on }),
    onSuccess: (data) => { queryClient.setQueryData(["pending-settings"], data); toast.success(data.hold_unusual === false ? "Valores fora do normal também serão registrados, com a marca “valor alto”." : "Valores fora do normal voltam a esperar você."); },
    onError: (error) => toast.error(getApiErrorMessage(error, "Não foi possível salvar agora.")),
  });
  const auto = useMutation({
    mutationFn: (on: boolean) => savePendingSettings({ auto_register: on }),
    onSuccess: (data) => { queryClient.setQueryData(["pending-settings"], data); toast.success(data.auto_register ? "Registro automático ligado." : "Registro automático desligado."); },
    onError: (error) => toast.error(getApiErrorMessage(error, "Não foi possível salvar agora.")),
  });

  const hasCode = (tokens.data?.length ?? 0) > 0 || Boolean(fresh);
  const received = (activity.data ?? []).filter((a) => a.action === "pendente" && a.ok);
  const header = bearerValue(code);
  const working = received.length > 0;
  // The guide is what a new user needs; once purchases arrive it only gets in the way.
  const [guideOpen, setGuideOpen] = useState<boolean | null>(null);
  const showGuide = guideOpen ?? !working;
  const status = working
    ? { Icon: CheckCircle2, tone: "border-income/30 bg-income/5", iconTone: "text-income", title: "Funcionando", text: `Última compra recebida em ${formatDate(String(received[0].at).slice(0, 10))}. As compras aparecem no Início para revisar.` }
    : hasCode
      ? { Icon: AlertCircle, tone: "border-amber-500/30 bg-amber-500/5", iconTone: "text-amber-600", title: "Falta terminar no iPhone", text: "O código já existe, mas nenhuma compra chegou ainda. Siga os passos abaixo e pague algo, ou rode a automação à mão." }
      : { Icon: CircleDashed, tone: "border-border bg-muted/40", iconTone: "text-muted-foreground", title: "Ainda não configurado", text: "Leva uns 3 minutos no app Atalhos do iPhone. Depois disso, cada compra com a Carteira chega aqui sem abrir o FINNOS." };

  return (
    <div className="space-y-4 text-sm" data-testid="applepay-setup">
      <section className={cn("flex items-start gap-3 rounded-2xl border p-3", status.tone)} data-testid="applepay-status">
        <status.Icon className={cn("mt-0.5 h-5 w-5 shrink-0", status.iconTone)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{status.title}</p>
          <p className="text-xs text-muted-foreground">{status.text}</p>
          {working ? <Link to="/" className="mt-1.5 inline-block text-xs font-semibold text-primary">Ver compras para revisar</Link> : null}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-border p-3" data-testid="applepay-preferences">
        <h3 className="font-semibold">Como as compras são registradas</h3>
        <div className="flex items-start gap-3">
          <span className="flex w-9 shrink-0 gap-0.5 pt-0.5 text-primary" aria-hidden="true"><Landmark className="h-4 w-4" /><CreditCard className="h-4 w-4 opacity-50" /></span>
          <p className="min-w-0 text-xs text-muted-foreground"><span className="block text-sm font-medium text-foreground">Débito é o padrão</span>O Apple Pay não diz se foi débito ou crédito. Toda compra chega como débito; em “Alterar”, troque para Crédito e escolha cartão e parcelas.</p>
        </div>
        <div className="flex items-start gap-3">
          <span className="w-9 shrink-0 pt-0.5 text-primary" aria-hidden="true"><Sparkles className="h-4 w-4" /></span>
          <p className="min-w-0 text-xs text-muted-foreground"><span className="block text-sm font-medium text-foreground">O FINNOS aprende</span>A categoria de cada comerciante e a conta ou cartão de cada cartão do Apple Pay. A próxima compra já vem preenchida.</p>
        </div>
        <label className="flex items-start justify-between gap-3 border-t border-border pt-3">
          <span className="min-w-0"><span className="block font-medium">Registrar automaticamente</span><span className="block text-xs text-muted-foreground">Só no débito, depois de 3 registros iguais seguidos. Crédito, comerciante novo e cartão com nome de conta (como “Nubank”) sempre esperam você. Dá para desfazer no Início.</span></span>
          <Switch on={Boolean(settings.data?.auto_register)} label="Registrar automaticamente" disabled={!settings.data || auto.isPending} onToggle={() => auto.mutate(!settings.data?.auto_register)} testId="applepay-auto-switch" />
        </label>
        <label className={cn("flex items-start justify-between gap-3 pl-4", !settings.data?.auto_register && "opacity-50")} data-testid="applepay-hold-row">
          <span className="min-w-0"><span className="block font-medium">Esperar quando o valor fugir do normal</span><span className="block text-xs text-muted-foreground">Mais que o dobro do que você costuma gastar naquele comerciante. Se desligar, a compra é registrada e aparece marcada “valor alto” no Início e no Fluxo (filtro Origem → Apple Pay).</span></span>
          <Switch on={settings.data?.hold_unusual !== false} label="Esperar quando o valor fugir do normal" disabled={!settings.data?.auto_register || hold.isPending} onToggle={() => hold.mutate(settings.data?.hold_unusual === false)} testId="applepay-hold-switch" />
        </label>
      </section>

      {tokens.data?.length ? (
        <section className="space-y-2 rounded-2xl border border-border p-3" data-testid="applepay-devices">
          <h3 className="flex items-center gap-2 font-semibold"><Smartphone className="h-4 w-4 text-primary" aria-hidden="true" />iPhones conectados</h3>
          <ul className="divide-y divide-border" data-testid="shortcut-tokens">
            {tokens.data.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1"><span className="block font-medium">{t.label} <span className="text-xs text-muted-foreground">•••• {t.hint}</span></span><span className="block text-xs text-muted-foreground">{t.last_used_at ? `Usado em ${formatDate(t.last_used_at.slice(0, 10))}` : "Ainda não usado"}</span></span>
                <button type="button" onClick={() => revoke.mutate(t.id)} disabled={revoke.isPending} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-expense"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Desconectar</button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border" data-testid="applepay-guide">
        <button type="button" onClick={() => setGuideOpen(!showGuide)} aria-expanded={showGuide} className="flex w-full items-center justify-between gap-2 p-3 text-left" data-testid="applepay-guide-toggle">
          <span className="min-w-0"><span className="block font-semibold">{working ? "Configuração no iPhone" : "Configurar no iPhone"}</span><span className="block text-xs text-muted-foreground">{working ? "Passo a passo, para outro iPhone ou para refazer." : "7 passos no app Atalhos, com o desenho de cada tela."}</span></span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", showGuide && "rotate-180")} aria-hidden="true" />
        </button>
        {showGuide ? (
          <div className="space-y-5 border-t border-border p-3">
            <section className="space-y-2">
              <h3 className="font-semibold">Como funciona</h3>
              <ApplePayFlow />
              <p className="text-muted-foreground">Nada entra no saldo sem você: a compra espera até você tocar em Registrar. Se o cartão do Apple Pay não estiver cadastrado, o FINNOS pergunta de onde saiu o dinheiro.</p>
            </section>
      <ol className="space-y-5" data-testid="applepay-steps">
        <Step n={1} done={hasCode} title="Gere o código de conexão">
          <p className="text-muted-foreground">É o que deixa o iPhone falar com a sua conta. Só cria compras pendentes e lista nomes; você desconecta quando quiser.</p>
          {fresh ? (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3" data-testid="applepay-fresh-code">
              <p className="font-semibold">Guarde: ele não aparece de novo.</p>
              <CopyField value={code ?? ""} label="código" />
            </div>
          ) : (
            <button type="button" onClick={() => create.mutate()} disabled={create.isPending} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-3 font-semibold text-primary-foreground disabled:opacity-60" data-testid="applepay-create-code">
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              {hasCode ? "Gerar outro código" : "Gerar código"}
            </button>
          )}
        </Step>

        <Step n={2} title="Abra o app Atalhos e crie a automação">
          <p className="text-muted-foreground">Automação → <strong>+</strong> → <strong>Transação</strong> (no iOS 26 aparece como <strong>Carteira</strong>).</p>
          <StepPicture n={2} alt="App Atalhos, aba Automação"><MockAutomationTab /></StepPicture>
          <a href={SHORTCUTS_APP} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border px-3 font-semibold" data-testid="applepay-open-shortcuts"><ExternalLink className="h-4 w-4" aria-hidden="true" />Abrir o app Atalhos</a>
        </Step>

        <Step n={3} title="Escolha o cartão e execute na hora">
          <p className="text-muted-foreground">Marque o cartão da Carteira, ligue <strong>Executar Imediatamente</strong>, toque em Próximo e em <strong>Nova Automação em Branco</strong>.</p>
          <StepPicture n={3} alt="Escolher o cartão e Executar Imediatamente"><MockTrigger /></StepPicture>
        </Step>

        <Step n={4} title="Adicione “Obter Conteúdo do URL”">
          <p className="text-muted-foreground">Cole este endereço e mude o método para <strong>POST</strong>.</p>
          <CopyField value={endpoint} label="endereço" />
          <StepPicture n={4} alt="Ação Obter Conteúdo do URL"><MockUrlAction url={endpoint} /></StepPicture>
        </Step>

        <Step n={5} title="Cabeçalho e corpo">
          <p className="text-muted-foreground">Em <strong>Cabeçalhos</strong>, <code>Authorization</code> com este valor{code ? "" : " (troque fns_… pelo código do passo 1)"}:</p>
          <CopyField value={header} label="cabeçalho Authorization" />
          <p className="text-muted-foreground">Em <strong>Corpo da Solicitação</strong>, escolha <strong>JSON</strong> e adicione três campos de texto. Em cada um, toque no valor, escolha <strong>Entrada do Atalho</strong> e toque nela de novo para escolher a informação:</p>
          <ul className="space-y-1">
            {AUTOMATION_FIELDS.map((f) => (
              <li key={f.key} className="flex items-center gap-2"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{f.key}</code><span aria-hidden="true">→</span><strong>{f.pick}</strong><span className="text-xs text-muted-foreground">({f.hint})</span></li>
            ))}
          </ul>
          <StepPicture n={5} alt="Cabeçalho Authorization e corpo JSON"><MockBody header={header} /></StepPicture>
        </Step>

        <Step n={6} title="Opcional: veja a resposta na hora">
          <p className="text-muted-foreground">Adicione <strong>Obter Valor do Dicionário</strong> (chave <code>mensagem</code>) e <strong>Mostrar Notificação</strong>. Depois de pagar, o iPhone mostra o que foi guardado e de onde saiu.</p>
          <StepPicture n={6} alt="Notificação do Atalhos"><MockNotification /></StepPicture>
        </Step>

        <Step n={7} done={received.length > 0} title="Confira que funcionou">
          {received.length > 0 ? (
            <p className="text-income" data-testid="applepay-received">Já recebemos {received.length === 1 ? "1 compra" : `${received.length} compras`} do seu Atalho. A última foi em {formatDate(String(received[0].at).slice(0, 10))}.</p>
          ) : (
            <p className="text-muted-foreground" data-testid="applepay-not-received">Ainda não recebemos nenhuma compra do Atalho. Pague algo com o cartão escolhido, ou rode a automação à mão no app Atalhos. Esta linha muda sozinha quando a primeira chegar.</p>
          )}
          <button type="button" onClick={() => test.mutate()} disabled={test.isPending} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border px-3 font-semibold disabled:opacity-60" data-testid="applepay-test">
            {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ReceiptText className="h-4 w-4" aria-hidden="true" />}Ver uma compra de teste
          </button>
          <p className="text-xs text-muted-foreground">O teste mostra como as compras aparecem no Início e pode ser excluído. Ele não prova que o Atalho está configurado: quem prova isso é a linha acima.</p>
        </Step>
      </ol>

          </div>
        ) : null}
      </section>
    </div>
  );
}
