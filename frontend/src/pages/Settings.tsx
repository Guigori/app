import { useEffect, useState } from "react";
import { DataBackupCard } from "@/components/settings/DataBackupCard";
import { ScreenHeader } from "@/components/layout/BackButton";
import { RegisterDefaultCard } from "@/components/settings/RegisterDefaultCard";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Check, Cloud, GitCommitHorizontal, Loader2, LogOut, Mail, Smartphone, MessageCircleMore, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { getApiErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { endSession } from "@/lib/session";
import { authenticationLabel } from "@/lib/profileIdentity";
import type { User } from "@/types/finnos";
import { clearMyData, fetchMe, loadDemoData, updateMyName } from "@/lib/data";
import { disableLocalMode, getMode, isLocalMode } from "@/lib/mode";
import { AiKeysCard } from "@/components/ai/AiKeysCard";
import { NotificationsCard } from "@/components/settings/NotificationsCard";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initials } from "@/components/layout/NavMenu";
import { NavigationSettings } from "@/components/settings/NavigationSettings";
import { resetLayout } from "@/lib/insights/layout";

const THEME_OPTIONS = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "system", label: "Sistema" },
];

/** "Conta com Google · desde março de 2026": how the person signs in, in plain words. */
function profileSubtitle(user: User | undefined, local: boolean): string {
  if (!user) return authenticationLabel(user);
  if (local) return user.session_mode === "demo" ? "Demonstração neste aparelho" : "Conta neste aparelho";
  const how = user.auth_provider === "google.com" ? "Conta com Google" : user.auth_provider === "password" ? "Conta com e-mail e senha" : "Conta FINNOS";
  const since = user.created_at ? new Date(user.created_at).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : "";
  return since && since !== "Invalid Date" ? `${how} · desde ${since}` : how;
}

/** Configurações sections (/configuracoes/:section) and Meu perfil (/perfil). */
export default function Settings({ forcedSection }: { forcedSection?: string } = {}) {
  const navigate = useNavigate();
  const { section } = useParams<{ section?: string }>();
  const currentSection = forcedSection ?? section ?? "perfil";
  const [confirmLogout, setConfirmLogout] = useState(false);
  const visible = (...names: string[]) => names.includes(currentSection);
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 5 * 60 * 1000 });
  const local = user ? user.session_mode === "local" || user.session_mode === "demo" : isLocalMode();

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
    <div className="mx-auto max-w-2xl space-y-5 pb-44 sm:pb-32 animate-fade-up">
      <ScreenHeader title={({ perfil: "Meu perfil", versao: "Sobre o FINNOS", aparencia: "Aparência", registro: "Botão +", painel: "Tela de Início", navegacao: "Personalizar navegação", dados: "Dados e backup", notificacoes: "Notificações", seguranca: "Segurança e privacidade", suporte: "Ajuda e suporte" } as Record<string,string>)[currentSection] ?? "Configurações"} subtitle={visible("perfil", "seguranca") ? undefined : visible("navegacao") ? "Escolha o que aparece e em que ordem" : "Como o FINNOS funciona para você."} keepSubtitle={visible("navegacao")} onBack={forcedSection === "perfil" || section === "seguranca" ? () => (window.history.length > 1 ? navigate(-1) : navigate("/")) : undefined} />

      {visible("desenvolvedor") && !local && (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Os controles de demonstração e limpeza deste aparelho são exclusivos do modo local.
          A exclusão de dados da conta Firebase precisa de confirmação e recuperação específicas.
          Nenhum dado online será apagado por esses botões.
        </p>
      )}
      {visible("perfil", "seguranca") && (<>
      <section aria-label="Você" className="flex flex-col items-center pt-2 text-center" data-testid="profile-identity">
        <span className="grid size-[5.75rem] place-items-center rounded-full bg-primary/10 font-heading text-[2rem] font-bold text-primary dark:text-[#B3A6FF]">
          {local ? <Smartphone className="size-9" aria-hidden="true" /> : initials(user?.name ?? "")}
        </span>
        <p className="mt-3 font-heading text-[1.3rem] font-bold">{user?.name ?? ""}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground" data-testid="settings-auth-provider">{profileSubtitle(user, local)}</p>
      </section>
      <p className="px-2 pt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Dados pessoais</p>
      <div className="rounded-[18px] border border-border bg-card p-3.5" data-testid="settings-profile-card">
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) nameMutation.mutate(); }} data-testid="settings-profile-form">
          <Label htmlFor="settings-name" className="text-xs font-semibold text-muted-foreground">Nome</Label>
          <div className="mt-1.5 flex gap-2">
            <Input id="settings-name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80} className="h-[46px] min-w-0 flex-1 rounded-xl text-[15px]" data-testid="settings-name-input" />
            <Button type="submit" className="h-[46px] rounded-xl px-4 font-bold" disabled={nameMutation.isPending || (user?.name ?? "") === name.trim()} data-testid="settings-save-name-button">
              {nameMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Salvar"}
            </Button>
          </div>
        </form>
        {local ? null : (
          <div className="mt-3.5 flex items-center gap-3 border-t border-border pt-3.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-primary dark:text-[#B3A6FF]"><Mail className="size-[1.1rem]" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">E-mail</span><span className="block truncate text-xs text-muted-foreground">{user?.email ?? ""}</span></span>
            {user?.auth_provider === "google.com" ? <span className="text-xs text-muted-foreground">Pelo Google</span> : null}
          </div>
        )}
      </div>

      </>)}
      {visible("versao") && (<>
      <Card data-testid="settings-version-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-heading"><GitCommitHorizontal className="h-4.5 w-4.5 text-primary" aria-hidden="true" />Versão do FINNOS</CardTitle>
          <CardDescription>Identificação desta compilação para controle do beta, commits e deploys.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-muted/60 p-3"><span className="block text-xs text-muted-foreground">Versão</span><strong>{__FINNOS_VERSION__}</strong></div>
            <div className="rounded-xl bg-muted/60 p-3"><span className="block text-xs text-muted-foreground">Canal</span><strong>Beta</strong></div>
            <div className="rounded-xl bg-muted/60 p-3"><span className="block text-xs text-muted-foreground">Commit</span><strong className="font-mono">{__FINNOS_COMMIT__}</strong></div>
            <div className="rounded-xl bg-muted/60 p-3"><span className="block text-xs text-muted-foreground">Ambiente</span><strong>{__FINNOS_ENV__}</strong></div>
          </div>
          <p className="text-xs text-muted-foreground">Build: {new Date(__FINNOS_BUILD_TIME__).toLocaleString("pt-BR")}. Ao reportar um erro, informe a versão e o commit exibidos aqui.</p>
        </CardContent>
      </Card>

      </>)}
      {visible("aparencia") && (<>
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

      </>)}
      {visible("graficos") && (<>
      <Card data-testid="settings-charts-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-heading">
            <BarChart3 className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
            Gráficos FINNOS
          </CardTitle>
          <CardDescription>Conheça a biblioteca visual oficial, a semântica das cores e onde cada gráfico é usado.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/configuracoes/graficos" className={buttonVariants({ variant: "outline" })} data-testid="settings-charts-link">
            Ver biblioteca de gráficos
          </Link>
        </CardContent>
      </Card>

      </>)}
      {visible("painel") && (<>
      <Card id="home-panel" data-testid="settings-home-panel-card">
        <CardHeader>
          <CardTitle className="font-heading">Painel da Home</CardTitle>
          <CardDescription>Escolha o que aparece, o tamanho e a ordem. A mesma configuração vale para Web e Mobile.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">O Início agora é montado como os widgets do iPhone: escolha análises na biblioteca, em tamanho Pequeno, Médio, Grande ou Extra grande, e arraste para ordenar.</p>
          <div className="flex flex-wrap gap-2">
            <Link to="/?editar=1" className={buttonVariants()} data-testid="settings-edit-home">Editar o Início</Link>
            <Button variant="outline" type="button" onClick={() => { resetLayout("inicio"); toast.success("Painel padrão restaurado."); }}>Restaurar painel padrão</Button>
          </div>
        </CardContent>
      </Card>

      </>)}
      {visible("navegacao") && <NavigationSettings />}
      {visible("orcamento") && (<>
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

      </>)}
      {visible("registro") && <RegisterDefaultCard />}
      {visible("dados") && <DataBackupCard />}
      {visible("perfil", "seguranca") && (<>
      <p className="px-2 pt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Sua conta</p>
      <div className="overflow-hidden rounded-[18px] border border-border bg-card" data-testid="settings-mode-card">
        <div className="flex min-h-[60px] items-center gap-3 px-3.5 py-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-primary dark:text-[#B3A6FF]">{local ? <Smartphone className="size-[1.1rem]" aria-hidden="true" /> : <Cloud className="size-[1.1rem]" aria-hidden="true" />}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">{local ? "Neste aparelho" : "Na nuvem"}</span>
            <span className="block text-xs text-muted-foreground">{local ? "Os dados vivem só neste navegador. Limpar o navegador apaga tudo." : "Seus dados ficam salvos e sincronizados"}</span>
          </span>
          {local ? null : <span className="rounded-full bg-[#E9FBF2] px-2.5 py-1 text-[11px] font-bold text-[#047857] dark:bg-[#047857]/20 dark:text-[#34D399]">Sincronizado</span>}
        </div>
        {local ? (
          <div className="border-t border-border px-3.5 py-3">
            <Link to="/cadastro" className={buttonVariants({ variant: "outline" })} data-testid="settings-upgrade-account-link">Criar conta completa</Link>
            <p className="mt-2 text-xs text-muted-foreground">Ao criar sua conta, o FINNOS importa com segurança os dados deste aparelho para a nova conta.</p>
          </div>
        ) : null}
      </div>

      </>)}
      {visible("notificacoes") && <NotificationsCard />}

      {visible("integracoes") && !local ? <AiKeysCard /> : null}

      {visible("desenvolvedor") && local && (<>
      <Card data-testid="settings-demo-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-heading">
            Dados de demonstração
            <MessageCircleMore className="h-4 w-4 text-primary" aria-hidden="true" />
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

      </>)}
      {visible("perfil", "seguranca") && (<>
      <div data-testid="settings-session-card" className="pt-2 text-center">
        <Button variant="outline" onClick={() => setConfirmLogout(true)} className="h-12 w-full rounded-full border-[#F3C4CD] text-[#BE123C] hover:bg-[#FDECEC] hover:text-[#BE123C] dark:border-[#BE123C]/40 dark:text-[#FB7185]" data-testid="settings-logout-button">
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sair da conta
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">{local ? "Os dados deste aparelho continuam salvos nele." : "Seus dados continuam salvos na sua conta."}</p>
      </div>

      </>)}
      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title="Sair da conta?"
        description={local ? "Os dados deste aparelho continuam salvos nele." : "Para voltar, é só entrar de novo. Nada é apagado."}
        confirmLabel="Sair"
        destructive
        onConfirm={() => { setConfirmLogout(false); void handleLogout(); }}
      />
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
