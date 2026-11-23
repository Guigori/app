/** Ajuda e suporte: tell the team about a problem, an idea or a doubt. Goes to the beta inbox. */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bug, Check, HelpCircle, Lightbulb, Loader2, Smile } from "lucide-react";
import { lastScreen, sendFeedback, type FeedbackKind } from "@/lib/beta";
import { getApiErrorMessage } from "@/lib/errors";
import { isLocalMode } from "@/lib/mode";
import { cn } from "@/lib/utils";

const KINDS: Array<{ id: FeedbackKind; label: string; icon: typeof Bug; hint: string }> = [
  { id: "bug", label: "Problema", icon: Bug, hint: "O que você fez, o que esperava e o que aconteceu?" },
  { id: "ideia", label: "Ideia", icon: Lightbulb, hint: "O que faria o FINNOS ser mais útil para você?" },
  { id: "duvida", label: "Dúvida", icon: HelpCircle, hint: "Conte o que não ficou claro." },
  { id: "elogio", label: "Elogio", icon: Smile, hint: "O que você mais gostou?" },
];

const SCREEN_NAMES: Array<[RegExp, string]> = [
  [/^\/$/, "Início"], [/^\/orcamento/, "Orçamento"], [/^\/transacoes/, "Fluxo"], [/^\/contas|^\/cartoes/, "Carteira"],
  [/^\/analise/, "Análises"], [/^\/radar/, "Radar"], [/^\/assinaturas/, "Assinaturas"], [/^\/patrimonio|^\/metas|^\/investimentos/, "Patrimônio"],
  [/^\/registro/, "Registro"], [/^\/historico/, "Histórico"],
];
const screenName = (path: string) => SCREEN_NAMES.find(([re]) => re.test(path))?.[1] ?? path;

export function FeedbackCard() {
  const local = isLocalMode();
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [mood, setMood] = useState<number | null>(null);
  const previous = lastScreen();
  const [attach, setAttach] = useState(Boolean(previous));
  const current = KINDS.find((k) => k.id === kind)!;

  const send = useMutation({
    mutationFn: () => sendFeedback({ kind, message: message.trim(), mood, screen: attach && previous ? previous : "/configuracoes/suporte" }),
    onSuccess: () => { setMessage(""); setMood(null); },
  });

  if (local) {
    return <section className="rounded-3xl border border-border bg-card p-5 text-sm text-muted-foreground">No modo local nada sai deste aparelho, então o envio de feedback fica desligado. Entre com uma conta para falar com a gente.</section>;
  }

  if (send.isSuccess) {
    return (
      <section role="status" className="rounded-3xl border border-border bg-card p-6 text-center" data-testid="feedback-sent">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-500/10 text-emerald-600"><Check className="h-6 w-6" /></span>
        <p className="mt-3 font-heading text-lg font-semibold">Mensagem enviada</p>
        <p className="mt-1 text-sm text-muted-foreground">Obrigado. A gente lê tudo e, se precisar, responde no seu e-mail.</p>
        <button type="button" onClick={() => send.reset()} className="mt-4 text-sm font-semibold text-primary">Mandar outra</button>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-3xl border border-border bg-card p-5" data-testid="feedback-card">
      <div>
        <h2 className="font-heading text-lg font-semibold">Fale com a gente</h2>
        <p className="mt-1 text-sm text-muted-foreground">O FINNOS está em beta. Cada problema ou ideia que você manda vira ajuste no app.</p>
      </div>
      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Tipo de mensagem">
        {KINDS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="radio" aria-checked={kind === id} onClick={() => setKind(id)} data-testid={`feedback-kind-${id}`}
            className={cn("flex flex-col items-center gap-1.5 rounded-2xl border px-1 py-3 text-xs font-semibold transition", kind === id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
            <Icon className="h-5 w-5" aria-hidden="true" />{label}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="sr-only">Mensagem</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={2000} placeholder={current.hint}
          className="w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-[15px] leading-relaxed outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15" data-testid="feedback-message" />
      </label>
      <div>
        <p className="text-sm font-medium">Como está sendo usar o FINNOS?</p>
        <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Nota de 1 a 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={mood === n} onClick={() => setMood(mood === n ? null : n)}
              className={cn("h-10 flex-1 rounded-xl border text-sm font-semibold transition", mood === n ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground")}>{n}</button>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground"><span>Difícil</span><span>Muito bom</span></div>
      </div>
      {previous ? (
        <label className="flex items-center gap-3 text-sm text-muted-foreground">
          <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} className="h-4 w-4 accent-[#4B2CFF]" />
          É sobre a tela {screenName(previous)}
        </label>
      ) : null}
      <p className="text-xs text-muted-foreground">Junto vão o modelo do aparelho e a versão do app. Nenhum valor ou lançamento seu é enviado.</p>
      {send.isError ? <p role="alert" className="text-sm font-medium text-destructive">{getApiErrorMessage(send.error, "Não deu para enviar. Tente de novo.")}</p> : null}
      <button type="button" disabled={message.trim().length < 3 || send.isPending} onClick={() => send.mutate()} data-testid="feedback-send"
        className="flex h-12 w-full items-center justify-center rounded-2xl bg-primary font-semibold text-primary-foreground disabled:opacity-50">
        {send.isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-label="Enviando" /> : "Enviar mensagem"}
      </button>
    </section>
  );
}
