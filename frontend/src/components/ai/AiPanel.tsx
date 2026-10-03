import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, Send, Sparkles } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/errors";
import { isLocalMode } from "@/lib/mode";
import type { AiAnswer, AiKey, AiProvider } from "@/types/finnos";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const SUGGESTIONS = [
  "Quanto gastei este mês?",
  "Em qual categoria estou gastando mais?",
  "Quanto ainda posso gastar?",
  "Como está minha regra 50/30/20?",
  "Quais contas vencem nos próximos dias?",
];

export function AiPanel() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [provider, setProvider] = useState<AiProvider | "">("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const local = isLocalMode();

  const keysQuery = useQuery({
    queryKey: ["ai-keys"],
    queryFn: () => apiGet<AiKey[]>("/ai/keys"),
    enabled: open && !local,
    staleTime: 30_000,
  });
  const keys = keysQuery.data ?? [];
  const activeProvider = (provider || keys[0]?.provider || "") as AiProvider | "";

  const askMutation = useMutation({
    mutationFn: (q: string) => apiPost<AiAnswer>("/ai/ask", { provider: activeProvider, question: q }),
    onSuccess: (data) => {
      setAnswer(data.answer);
      setError(null);
    },
    onError: (err) => {
      setAnswer(null);
      setError(getApiErrorMessage(err, "Não foi possível consultar a IA agora."));
    },
  });

  const ask = (q: string) => {
    const text = q.trim();
    if (!text || !activeProvider) return;
    setQuestion(text);
    setAnswer(null);
    setError(null);
    askMutation.mutate(text);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="fixed bottom-[9.75rem] right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-primary shadow-lg transition-transform duration-200 hover:scale-105 active:scale-100 dashboard:bottom-[5.25rem] dashboard:md:bottom-[6.25rem] dashboard:md:right-6"
        aria-label="Abrir FINNOS IA"
        data-testid="ai-trigger-button"
      >
        <Sparkles className="h-5 w-5" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto p-6 sm:max-w-md">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2 font-heading">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            FINNOS IA
          </SheetTitle>
          <SheetDescription className="text-left">
            Pergunte sobre as suas finanças. As respostas usam <strong>a sua própria chave</strong> de
            IA (ChatGPT, Claude ou Gemini) e um resumo dos seus dados montado no servidor.
          </SheetDescription>
        </SheetHeader>

        {local ? (
          <div className="rounded-xl border border-border bg-muted/50 p-4 text-sm" data-testid="ai-local-mode-notice">
            <p className="text-muted-foreground">
              Na conta local os dados ficam apenas neste aparelho, então a IA não pode consultá-los.
              Crie uma conta completa para usar a FINNOS IA com a sua chave.
            </p>
            <Link to="/cadastro" className={buttonVariants({ variant: "outline", className: "mt-3" })}>
              Criar conta completa
            </Link>
          </div>
        ) : keysQuery.isPending ? (
          <div className="h-24 animate-pulse rounded-xl bg-muted" aria-hidden="true" />
        ) : keys.length === 0 ? (
          <div className="rounded-xl border border-border bg-muted/50 p-4 text-sm" data-testid="ai-no-key-notice">
            <p className="font-medium text-foreground">Conecte sua IA</p>
            <p className="mt-1 text-muted-foreground">
              Cadastre a chave da sua conta do ChatGPT, Claude ou Gemini para liberar as respostas. A chave
              fica criptografada no servidor e nunca é exibida de volta.
            </p>
            <Link
              to="/configuracoes"
              onClick={() => setOpen(false)}
              className={buttonVariants({ className: "mt-3" })}
              data-testid="ai-configure-link"
            >
              Cadastrar minha chave
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <>
            {keys.length > 1 ? (
              <Select value={activeProvider} onValueChange={(v) => setProvider(v as AiProvider)}>
                <SelectTrigger size="sm" className="w-full" aria-label="Provedor de IA" data-testid="ai-provider-select">
                  <SelectValue>{keys.find((k) => k.provider === activeProvider)?.model ?? "Selecionar"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {keys.map((k) => (
                    <SelectItem key={k.provider} value={k.provider}>
                      {k.provider} · {k.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="secondary" className="w-fit" data-testid="ai-active-model">
                {keys[0].provider} · {keys[0].model}
              </Badge>
            )}

            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                ask(question);
              }}
              data-testid="ai-ask-form"
            >
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Pergunte algo sobre suas finanças…"
                maxLength={2000}
                aria-label="Sua pergunta"
                data-testid="ai-question-input"
              />
              <Button type="submit" size="icon" disabled={askMutation.isPending || !question.trim()} aria-label="Enviar pergunta" data-testid="ai-send-button">
                {askMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>

            {askMutation.isPending ? (
              <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground" data-testid="ai-loading">
                Consultando sua IA…
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm font-medium text-destructive" data-testid="ai-error">
                {error}
              </p>
            ) : null}
            {answer ? (
              <div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed whitespace-pre-line" data-testid="ai-answer">
                {answer}
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sugestões</p>
              {SUGGESTIONS.map((suggestion, index) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => ask(suggestion)}
                  disabled={askMutation.isPending}
                  className="flex items-center justify-between rounded-xl bg-muted px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
                  data-testid={`ai-suggestion-${index}`}
                >
                  {suggestion}
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              ))}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
