import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, Loader2, LogOut, Smartphone, Sparkles, Trash2 } from "lucide-react";
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
import { MAIN_NAV } from "@/components/layout/nav";
import { defaultNavigationPreferences, resetNavigationPreferences, saveNavigationPreferences, useNavigationPreferences, type NavigationPreferences } from "@/lib/navigationPreferences";
import { HOME_MODULES, resetHomePreferences, saveHomePreferences, useHomePreferences, type HomeModuleId } from "@/lib/homePreferences";

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

  const savedNavigation = useNavigationPreferences();
  const savedHome = useHomePreferences();
  const [homePanel, setHomePanel] = useState(savedHome);
  useEffect(() => setHomePanel(savedHome), [JSON.stringify(savedHome)]);
  const [navigation, setNavigation] = useState<NavigationPreferences>(savedNavigation);
  useEffect(() => setNavigation(savedNavigation), [JSON.stringify(savedNavigation)]);

  const mobileNavigation = MAIN_NAV.filter((item) => !item.soon && item.slug !== "inicio" && item.slug !== "ia");
  const webNavigation = MAIN_NAV.filter((item) => !item.soon && item.slug !== "inicio" && item.slug !== "ia");
  const updateNavigation = (target: "mobile" | "web", slug: string, enabled: boolean) => {
    setNavigation((current) => {
      const list = current[target];
      const next = enabled ? [...list, slug] : list.filter((item) => item !== slug);
      const normalized = target === "mobile" ? ["inicio", ...next.filter((x) => x !== "inicio")].slice(0, 4) : ["inicio", ...next.filter((x) => x !== "inicio")];
      const value = { ...current, [target]: normalized };
      saveNavigationPreferences(value);
      return value;
    });
  };
  const moveNavigation = (target: "mobile" | "web", slug: string, direction: -1 | 1) => {
    setNavigation((current) => {
      const list = [...current[target]];
      const index = list.indexOf(slug);
      const destination = index + direction;
      if (slug === "inicio" || index < 1 || destination < 1 || destination >= list.length) return current;
      [list[index], list[destination]] = [list[destination], list[index]];
      const value = { ...current, [target]: list };
      saveNavigationPreferences(value);
      return value;
    });
  };

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

      <Card id="home-panel" data-testid="settings-home-panel-card">
        <CardHeader>
          <CardTitle className="font-heading">Painel da Home</CardTitle>
          <CardDescription>Escolha o que aparece e a ordem dos módulos. A mesma configuração vale para Web e Mobile.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-xl border border-border">
            {homePanel.order.map((id, index) => {
              const item = HOME_MODULES.find((module) => module.id === id)!;
              const visible = !homePanel.hidden.includes(id);
              const move = (direction: -1 | 1) => {
                const destination = index + direction;
                if (destination < 0 || destination >= homePanel.order.length) return;
                const order = [...homePanel.order];
                [order[index], order[destination]] = [order[destination], order[index]];
                const next = { ...homePanel, order };
                setHomePanel(next);
                saveHomePreferences(next);
              };
              return (
                <div key={id} className="flex items-center gap-2 border-b border-border px-3 py-3 last:border-b-0">
                  <span className="min-w-0 flex-1 text-sm font-medium">{item.label}</span>
                  <button type="button" className="rounded-md p-1 text-muted-foreground disabled:opacity-30" disabled={index === 0} onClick={() => move(-1)} aria-label={`Mover ${item.label} para cima`}><ChevronUp className="h-4 w-4" /></button>
                  <button type="button" className="rounded-md p-1 text-muted-foreground disabled:opacity-30" disabled={index === homePanel.order.length - 1} onClick={() => move(1)} aria-label={`Mover ${item.label} para baixo`}><ChevronDown className="h-4 w-4" /></button>
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={(event) => {
                      const hidden = event.target.checked ? homePanel.hidden.filter((x) => x !== id) : [...homePanel.hidden, id as HomeModuleId];
                      const next = { ...homePanel, hidden };
                      setHomePanel(next);
                      saveHomePreferences(next);
                    }}
                    aria-label={`${visible ? "Ocultar" : "Mostrar"} ${item.label}`}
                    className="h-4 w-4 accent-primary"
                  />
                </div>
              );
            })}
          </div>
          <Button variant="outline" type="button" onClick={() => { resetHomePreferences(); setHomePanel({ order: HOME_MODULES.map((item) => item.id), hidden: [] }); }}>
            Restaurar painel padrão
          </Button>
        </CardContent>
      </Card>

      <Card id="navigation" data-testid="settings-navigation-card">
        <CardHeader>
          <CardTitle className="font-heading">Barra de navegação</CardTitle>
          <CardDescription>Escolha e reordene os atalhos do mobile e da Web. Início é fixo e não pode ser removido.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {(["mobile", "web"] as const).map((target) => (
            <div key={target} className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">{target === "mobile" ? "Mobile" : "Web"}</h3>
                <p className="text-xs text-muted-foreground">{target === "mobile" ? "Até 4 atalhos, incluindo Início. O botão + continua separado." : "Escolha os itens exibidos na navegação principal."}</p>
              </div>
              <label className="flex items-center gap-3 rounded-[1.35rem] border border-white/20 bg-background/55 px-4 py-3.5 shadow-[0_10px_32px_rgba(0,0,0,.10),inset_0_1px_0_rgba(255,255,255,.22)] backdrop-blur-[24px] supports-[backdrop-filter]:bg-background/45">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="flex-1 text-sm font-medium">FINNOS IA — desmarque para remover</span>
                <input
                  type="checkbox"
                  checked={target === "mobile" ? navigation.aiMobile : navigation.aiWeb}
                  onChange={(event) => {
                    const value = { ...navigation, [target === "mobile" ? "aiMobile" : "aiWeb"]: event.target.checked };
                    setNavigation(value);
                    saveNavigationPreferences(value);
                  }}
                  className="h-4 w-4 accent-primary"
                />
              </label>
              <div className="overflow-hidden rounded-[1.6rem] border border-white/20 bg-background/55 shadow-[0_12px_36px_rgba(0,0,0,.10),inset_0_1px_0_rgba(255,255,255,.22)] backdrop-blur-[26px] supports-[backdrop-filter]:bg-background/45">
                <div className="flex items-center gap-3 border-b border-border/55 px-4 py-3.5">
                  <Check className="h-4 w-4 text-primary" />
                  <span className="flex-1 text-sm font-medium">Início</span>
                  <span className="text-xs text-muted-foreground">Fixo</span>
                </div>
                {(target === "mobile" ? mobileNavigation : webNavigation).map((item) => {
                  const enabled = navigation[target].includes(item.slug);
                  const position = navigation[target].indexOf(item.slug);
                  const mobileFull = target === "mobile" && navigation.mobile.length >= 4;
                  return (
                    <div key={item.slug} className="flex items-center gap-2 border-b border-border/55 px-4 py-3 last:border-b-0 transition-colors hover:bg-background/35">
                      <item.icon className="h-4 w-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                      {enabled ? (
                        <>
                          <button type="button" className="rounded-md p-1 text-muted-foreground disabled:opacity-30" disabled={position <= 1} onClick={() => moveNavigation(target, item.slug, -1)} aria-label={`Mover ${item.label} para cima`}><ChevronUp className="h-4 w-4" /></button>
                          <button type="button" className="rounded-md p-1 text-muted-foreground disabled:opacity-30" disabled={position === navigation[target].length - 1} onClick={() => moveNavigation(target, item.slug, 1)} aria-label={`Mover ${item.label} para baixo`}><ChevronDown className="h-4 w-4" /></button>
                        </>
                      ) : null}
                      <input type="checkbox" checked={enabled} disabled={!enabled && mobileFull} onChange={(event) => updateNavigation(target, item.slug, event.target.checked)} aria-label={`${enabled ? "Remover" : "Adicionar"} ${item.label} da navegação ${target}`} className="h-4 w-4 accent-primary" />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <Button variant="outline" type="button" onClick={() => { resetNavigationPreferences(); setNavigation(defaultNavigationPreferences()); }}>
            Restaurar padrão
          </Button>
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
              Ao criar sua conta, o FINNOS importa com segurança os dados deste aparelho para a nova conta. Os dados locais só deixam de ser usados depois que a importação for confirmada.
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
