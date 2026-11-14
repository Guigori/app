import { useTheme } from "next-themes";
import { Link } from "react-router-dom";
import type { ComponentType } from "react";
import { BarChart3, Bell, ChevronRight, CircleHelp, Cloud, Info, LayoutDashboard, MessageCircleMore, Palette, PanelBottom, PenLine, Smartphone, Tags, Trash2, Zap } from "lucide-react";
import { saveNavigationPreferences, useNavigationPreferences } from "@/lib/navigationPreferences";
import { cn } from "@/lib/utils";

type Item = { label: string; description: string; icon: ComponentType<{ className?: string }>; href: string; action?: "install"; danger?: boolean };

/**
 * Configurações: how the FINNOS works for each person. The places to use it are in the menu, and who
 * the person is (name, account, sign out) in Meu perfil.
 */
const groups: { title: string; items: Item[] }[] = [
  { title: "Aparência e navegação", items: [
    { label: "Barra e menu", description: "Abas de baixo, ordem e o que aparece no menu", icon: PanelBottom, href: "/configuracoes/navegacao" },
    { label: "Tela de Início", description: "Escolha e organize os blocos", icon: LayoutDashboard, href: "/configuracoes/painel" },
    { label: "Botão +", description: "O que abre primeiro ao registrar", icon: PenLine, href: "/configuracoes/registro" },
    { label: "Gráficos", description: "Estilo e cores dos gráficos", icon: BarChart3, href: "/configuracoes/graficos" },
  ] },
  { title: "Organização", items: [
    { label: "Categorias", description: "Criar, editar e agrupar", icon: Tags, href: "/categorias" },
    { label: "Notificações", description: "Vencimentos, faturas e lembretes", icon: Bell, href: "/configuracoes/notificacoes" },
  ] },
  { title: "Dados", items: [
    { label: "Dados e backup", description: "Exportar, importar e restaurar", icon: Cloud, href: "/configuracoes/dados" },
    { label: "Instalar no celular", description: "Abrir pela tela inicial, como um app", icon: Smartphone, href: "#instalar", action: "install" },
    { label: "Limpar ou testar dados", description: "Dados de demonstração e apagar tudo", icon: Trash2, href: "/configuracoes/desenvolvedor", danger: true },
  ] },
  { title: "Ajuda", items: [
    { label: "Ajuda e suporte", description: "Dúvidas e feedback do beta", icon: CircleHelp, href: "/configuracoes/suporte" },
    { label: "Sobre o FINNOS", description: "Versão e informações técnicas", icon: Info, href: "/configuracoes/versao" },
  ] },
];

const THEMES = [{ value: "light", label: "Claro" }, { value: "dark", label: "Escuro" }, { value: "system", label: "Do aparelho" }];

function Row({ item, first }: { item: Item; first: boolean }) {
  return (
    <Link to={item.href}
      onClick={item.action === "install" ? (event) => { event.preventDefault(); window.dispatchEvent(new Event("finnos-install-open")); } : undefined}
      className={cn("flex min-h-16 items-center gap-3 px-4 py-3 text-card-foreground transition-colors hover:bg-accent focus-visible:bg-accent", !first && "border-t border-border/70")}>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", item.danger ? "bg-[#FDECEC] text-[#BE123C] dark:bg-[#BE123C]/20 dark:text-[#FB7185]" : "bg-primary/10 text-primary dark:text-[#B3A6FF]")}>
        <item.icon className="size-[1.1rem]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm font-semibold", item.danger && "text-[#BE123C] dark:text-[#FB7185]")}>{item.label}</span>
        <span className="block text-xs text-muted-foreground">{item.description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

const CAPTION = "px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground";

export function SettingsHub() {
  const { theme, setTheme } = useTheme();
  const prefs = useNavigationPreferences();
  const conversa = prefs.aiMobile || prefs.aiWeb;
  const [first, ...rest] = groups;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 pb-28 text-foreground animate-fade-up" data-testid="settings-hub">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-bold">Configurações</h1>
        <p data-keep className="text-sm text-muted-foreground">Como o FINNOS funciona para você. Nome, conta e saída ficam em <Link to="/perfil" className="font-semibold text-primary underline-offset-2 hover:underline dark:text-[#B3A6FF]" data-testid="settings-profile-link">Meu perfil</Link>.</p>
      </header>

      <section aria-label={first.title} className="space-y-2">
        <h2 className={CAPTION}>{first.title}</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="px-4 pb-4 pt-3">
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:text-[#B3A6FF]"><Palette className="size-[1.1rem]" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Tema</span>
                <span className="block text-xs text-muted-foreground">{theme === "dark" ? "Sempre escuro" : theme === "light" ? "Sempre claro" : "Segue o tema do celular ou do computador"}</span>
              </span>
            </div>
            <div role="radiogroup" aria-label="Tema" className="mt-3 grid grid-cols-3 gap-1 rounded-full bg-muted p-1" data-testid="settings-theme-switch">
              {THEMES.map((option) => (
                <button key={option.value} type="button" role="radio" aria-checked={(theme ?? "system") === option.value} onClick={() => setTheme(option.value)}
                  className={cn("h-9 rounded-full text-[13px] font-semibold transition-colors", (theme ?? "system") === option.value ? "bg-card text-primary shadow-sm dark:text-[#B3A6FF]" : "text-muted-foreground hover:text-foreground")}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {first.items.map((item) => <Row key={item.label} item={item} first={false} />)}
        </div>
      </section>

      <section aria-label={rest[0].title} className="space-y-2">
        <h2 className={CAPTION}>{rest[0].title}</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {rest[0].items.map((item, index) => <Row key={item.label} item={item} first={index === 0} />)}
        </div>
      </section>

      <section aria-label="Conversa" className="space-y-2">
        <h2 className={CAPTION}>Conversa</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <label className="flex min-h-16 cursor-pointer items-center gap-3 px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:text-[#B3A6FF]"><MessageCircleMore className="size-[1.1rem]" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Conversa</span>
              <span className="block text-xs text-muted-foreground">{conversa ? "Ativada · aparece no menu e no topo" : "Desativada · o botão some do menu"}</span>
            </span>
            <input type="checkbox" role="switch" className="peer sr-only" checked={conversa}
              onChange={(e) => saveNavigationPreferences({ ...prefs, aiMobile: e.target.checked, aiWeb: e.target.checked })} data-testid="settings-conversa-switch" />
            <span aria-hidden="true" className="relative h-[30px] w-[50px] shrink-0 rounded-full bg-border transition-colors after:absolute after:left-[3px] after:top-[3px] after:size-6 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-5 peer-focus-visible:outline-2 peer-focus-visible:outline-primary" />
          </label>
          <Row item={{ label: "Integrações e automações", description: "Chave do provedor, Apple Pay e Atalhos", icon: Zap, href: "/configuracoes/integracoes" }} first={false} />
        </div>
      </section>

      {rest.slice(1).map((group) => (
        <section key={group.title} aria-label={group.title} className="space-y-2">
          <h2 className={CAPTION}>{group.title}</h2>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {group.items.map((item, index) => <Row key={item.label} item={item} first={index === 0} />)}
          </div>
        </section>
      ))}
      <footer className="pb-4 text-center text-xs text-muted-foreground">FINNOS · Beta 1</footer>
    </div>
  );
}
