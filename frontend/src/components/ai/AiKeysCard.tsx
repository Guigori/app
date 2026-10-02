import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPut } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import type { AiKey, AiProvider, AiProviderInfo } from "@/types/finnos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function AiKeysCard() {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<AiProvider>("openai");
  const [model, setModel] = useState<string>("");
  const [keyValue, setKeyValue] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const providersQuery = useQuery({
    queryKey: ["ai-providers"],
    queryFn: () => apiGet<AiProviderInfo[]>("/ai/providers"),
    staleTime: 10 * 60 * 1000,
  });
  const keysQuery = useQuery({ queryKey: ["ai-keys"], queryFn: () => apiGet<AiKey[]>("/ai/keys") });

  const providers = providersQuery.data ?? [];
  const keys = keysQuery.data ?? [];
  const selected = providers.find((p) => p.provider === provider);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiPut<AiKey>("/ai/keys", { provider, key: keyValue.trim(), model: model || selected?.default_model }),
    onSuccess: async (data) => {
      setKeyValue("");
      setFormError(null);
      toast.success(`Chave validada e salva (${data.masked}).`);
      await queryClient.invalidateQueries({ queryKey: ["ai-keys"] });
    },
    onError: (error) => setFormError(getApiErrorMessage(error, "Não foi possível validar a chave.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (p: AiProvider) => apiDelete<void>(`/ai/keys/${p}`),
    onSuccess: async () => {
      toast.success("Chave removida.");
      await queryClient.invalidateQueries({ queryKey: ["ai-keys"] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });

  return (
    <Card data-testid="settings-ai-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-heading">
          <Sparkles className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
          FINNOS IA — sua chave
        </CardTitle>
        <CardDescription>
          Conecte a sua própria conta de IA para fazer perguntas sobre suas finanças. A chave é validada na
          hora, guardada criptografada no servidor e nunca exibida de volta. O FINNOS não cobra nada pela IA —
          o consumo é faturado direto pelo seu provedor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {keys.length > 0 ? (
          <ul className="space-y-2" data-testid="ai-keys-list">
            {keys.map((k) => (
              <li key={k.provider} className="flex items-center gap-3 rounded-xl bg-muted/60 px-4 py-3" data-testid={`ai-key-${k.provider}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {providers.find((p) => p.provider === k.provider)?.label ?? k.provider}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {k.masked} · modelo {k.model}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0">Ativa</Badge>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => deleteMutation.mutate(k.provider)}
                  disabled={deleteMutation.isPending}
                  aria-label={`Remover chave ${k.provider}`}
                  data-testid={`ai-key-delete-${k.provider}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            if (keyValue.trim().length < 10) {
              setFormError("Cole a chave completa do provedor.");
              return;
            }
            saveMutation.mutate();
          }}
          data-testid="ai-key-form"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ai-provider">Provedor</Label>
              <Select
                value={provider}
                onValueChange={(v) => {
                  setProvider(v as AiProvider);
                  setModel("");
                }}
              >
                <SelectTrigger id="ai-provider" className="w-full" aria-label="Provedor de IA" data-testid="ai-provider-picker">
                  <SelectValue>{selected?.label ?? provider}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.provider} value={p.provider}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-model">Modelo</Label>
              <Select value={model || selected?.default_model || ""} onValueChange={setModel}>
                <SelectTrigger id="ai-model" className="w-full" aria-label="Modelo" data-testid="ai-model-picker">
                  <SelectValue>{model || selected?.default_model || ""}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(selected?.models ?? []).map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-key">Chave de API</Label>
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              placeholder="Cole a chave — ela não será exibida novamente"
              data-testid="ai-key-input"
            />
            {selected ? (
              <a
                href={selected.console_url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                data-testid="ai-console-link"
              >
                Onde pegar a chave do {selected.label}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            ) : null}
          </div>

          {formError ? (
            <p role="alert" className={cn("text-sm font-medium text-destructive")} data-testid="ai-key-error">
              {formError}
            </p>
          ) : null}

          <Button type="submit" disabled={saveMutation.isPending} data-testid="ai-key-save-button">
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Testar e salvar chave"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
