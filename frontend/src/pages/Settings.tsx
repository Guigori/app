import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, LogOut, Smartphone, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { getApiErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { endSession } from "@/lib/session";
import { clearMyData, fetchMe, loadDemoData, updateMyName } from "@/lib/data";
import { disableLocalMode, getMode, isLocalMode } from "@/lib/mode";
import { AiKeysCard } from "@/components/ai/AiKeysCard";
import { NotificationsCard } from "@/components/settings/NotificationsCard";
import type { User } from "@/types/finnos";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const THEME_OPTIONS = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "system", label: "Sistema" },
];

export default function Settings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const local = isLocalMode();
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 5 * 60 * 1000 });

  const [name, setName] = useState("");
  useEffect(() => {
    if (user) setName(user.name);
  }, [user]);

  const [confirmDemo, setConfirmDemo] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const nameMutation = useMutation({
    mutationFn: () => updateMyName(name.trim()),
    onSuccess: async () => {
      toast.success("Nome atualizado.");
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });

  const demoLoadMutation = useMutation({
    mutationFn: () => loadDemoData(),
    onSuccess: async () => {
      toast.success("Dados de demonstração carregados.");
      setConfirmDemo(false);
      await queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearMyData(),
    onSuccess: async () => {
      toast.success("Dados removidos. Sua conta está pronta para uso real.");
      setConfirmClear(false);
      await queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });

  const handleLogout = async () => {
    // Capture the current mode before clearing it. Local/demo sessions do not
    // have a server cookie, but account sessions must invalidate it.
    const mode = getMode();
    disableLocalMode();

    try {
      if (mode === "account") {
        await endSession();
      } else {
        queryClient.clear();
      }
    } finally {
      // replace prevents the authenticated page from remaining in browser history.
      navigate("/login", { replace: true });
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-fade-up">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Configurações</h1>
        <p className="mt-1 text-sm text-muted-foreground">Perfil, aparência e dados da sua conta.</p>
      </div>

      <Card data-testid="settings-profile-card">
        <CardHeader>
          <CardTitle className="font-heading">Perfil</CardTitle>
          <CardDescription>{user?.email ?? ""}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim().length >= 2) nameMutation.mutate();
            }}
            data-testid="settings-profile-form"
          >
            <div className="flex-1 space-y-2">
              <Label htmlFor="settings-name">Nome</Label>
              <Input id="settings-name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80} data-testid="settings-name-input" />
            </div>
            <Button type="submit" disabled={nameMutation.isPending || (user?.name ?? "") === name.trim()} data-testid="settings-save-name-button">
              {nameMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Salvar"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card data-testid="settings-theme-card">
        <CardHeader>
          <CardTitle className="font-heading">Aparência</CardTitle>
          <CardDescription>Escolha claro, escuro ou siga o sistema.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Tema">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTheme(option.value)}
                aria-pressed={theme === option.value}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors",
                  theme === option.value
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
                data-testid={`theme-option-${option.value}`}
              >
                {theme === option.value ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                {option.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card data-testid="settings-budget-card">
        <CardHeader>
          <CardTitle className="font-heading">Orçamento</CardTitle>
          <CardDescription>Modelo, periodicidade, próximo ciclo, prioridades e regras do seu planejamento.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/orcamento/configuracoes" className={buttonVariants({ variant: "outline" })} data-testid="settings-budget-link">
            Configurar orçamento
          </Link>
        </CardContent>
      </Card>

      <Card data-testid="settings-categories-card">
        <CardHeader>
          <CardTitle className="font-heading">Categorias</CardTitle>
          <CardDescription>Personalize ícones, cores, grupos 50/30/20 e orçamentos mensais.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/categorias" className={buttonVariants({ variant: "outline" })} data-testid="settings-manage-categories-link">
            Gerenciar categorias
          </Link>
        </CardContent>
      </Card>

      <Card data-testid="settings-mode-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-heading">
            {local ? <Smartphone className="h-4.5 w-4.5 text-primary" aria-hidden="true" /> : null}
            Modo de uso
          </CardTitle>
          <CardDescription>
            {local
              ? "Você está na conta local: nada é enviado para servidores e os dados vivem só neste navegador. Limpar os dados do navegador apaga tudo, e a FINNOS IA não fica disponível."
              : "Você está em uma conta completa: seus dados ficam protegidos no servidor, acessíveis de qualquer aparelho com o seu login."}
          </CardDescription>
        </CardHeader>
        {local ? (
          <CardContent>
            <Link to="/cadastro" className={buttonVariants({ variant: "outline" })} data-testid="settings-upgrade-account-link">
              Criar conta completa
            </Link>
            <p className="mt-2 text-xs text-muted-foreground">
              Ao criar a conta completa você começa com dados novos no servidor; os lançamentos locais
              continuam neste aparelho.
            </p>
          </CardContent>
        ) : null}
      </Card>

      <NotificationsCard />

      {local ? null : <AiKeysCard />}

      <Card data-testid="settings-demo-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-heading">
            Dados de demonstração
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          </CardTitle>
          <CardDescription>
            Carregue um conjunto fictício (contas Nubank, Inter e Itaú, assinaturas, um parcelamento e dois meses de
            histórico) para explorar a interface. Atenção: isso substitui todos os seus registros atuais.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setConfirmDemo(true)} disabled={demoLoadMutation.isPending} data-testid="load-demo-data-button">
            Carregar dados demo
          </Button>
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmClear(true)}
            disabled={clearMutation.isPending}
            data-testid="clear-my-data-button"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Limpar meus dados
          </Button>
        </CardContent>
      </Card>

      <Card data-testid="settings-session-card">
        <CardHeader>
          <CardTitle className="font-heading">Sessão</CardTitle>
          <CardDescription>Encerre a sessão neste dispositivo.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={handleLogout} data-testid="settings-logout-button">
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sair da conta
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmDemo}
        onOpenChange={setConfirmDemo}
        title="Carregar dados de demonstração?"
        description="Todos os seus registros atuais (contas, transações e categorias personalizadas) serão substituídos pelos dados fictícios."
        confirmLabel="Carregar dados demo"
        loading={demoLoadMutation.isPending}
        onConfirm={() => demoLoadMutation.mutate()}
      />
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Limpar todos os seus dados?"
        description="Contas, transações e categorias personalizadas serão removidas. Suas categorias padrão serão recriadas."
        confirmLabel="Limpar dados"
        destructive
        loading={clearMutation.isPending}
        onConfirm={() => clearMutation.mutate()}
      />
    </div>
  );
}
