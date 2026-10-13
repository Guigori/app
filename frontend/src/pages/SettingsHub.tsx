import { ChevronRight, UserRound, Landmark, Tags, ChartPie, Repeat2, Palette, LayoutDashboard, PanelBottom, BarChart3, ShieldCheck, Cloud, Bell, Zap, CircleHelp, Info, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/lib/data";

const groups = [
  { title: "Suas finanças", items: [
    { label: "Contas e cartões", description: "Bancos, cartões e faturas", icon: Landmark, href: "/contas" },
    { label: "Categorias", description: "Organização das movimentações", icon: Tags, href: "/categorias" },
    { label: "Orçamento", description: "Modelos, limites e planejamento", icon: ChartPie, href: "/orcamento/configuracoes" },
    { label: "Assinaturas", description: "Serviços e cobranças", icon: Repeat2, href: "/assinaturas" },
  ] },
  { title: "Personalização", items: [
    { label: "Aparência", description: "Tema claro, escuro ou sistema", icon: Palette, href: "/configuracoes/aparencia" },
    { label: "Painel da Home", description: "Organize seus módulos", icon: LayoutDashboard, href: "/configuracoes/painel" },
    { label: "Barra de navegação", description: "Atalhos mobile e web", icon: PanelBottom, href: "/configuracoes/navegacao" },
    { label: "Gráficos", description: "Biblioteca visual e preferências", icon: BarChart3, href: "/configuracoes/graficos" },
  ] },
  { title: "Aplicativo e privacidade", items: [
    { label: "Segurança e privacidade", description: "Conta e proteção de acesso", icon: ShieldCheck, href: "/configuracoes/perfil" },
    { label: "Dados e sincronização", description: "Armazenamento, importação e offline", icon: Cloud, href: "/configuracoes/dados" },
    { label: "Notificações", description: "Vencimentos e lembretes", icon: Bell, href: "/configuracoes/notificacoes" },
    { label: "Integrações e automações", description: "Apple Pay, Atalhos e FINNOS IA", icon: Zap, href: "/configuracoes/integracoes", soon: true },
  ] },
  { title: "Informações", items: [
    { label: "Ajuda e suporte", description: "Informações e feedback do beta", icon: CircleHelp, href: "/configuracoes/suporte" },
    { label: "Sobre o FINNOS", description: "Versão e informações técnicas", icon: Info, href: "/configuracoes/versao" },
  ] },
];

export function SettingsHub() {
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 5 * 60 * 1000 });
  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 pb-28 text-foreground animate-fade-up" data-testid="settings-hub">
      <header className="space-y-1">
        <div className="flex items-center gap-2"><Settings2 className="h-5 w-5 text-primary" /><h1 className="font-heading text-2xl font-bold">Configurações</h1></div>
        <p className="text-sm text-muted-foreground">Tudo do seu jeito, em um só lugar.</p>
      </header>
      <Link to="/configuracoes/perfil" className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-card-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary" data-testid="settings-profile-link">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><UserRound className="h-6 w-6" /></span>
        <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{user?.name || "Meu perfil"}</span><span className="block truncate text-xs text-muted-foreground">{user?.email || "Conta e informações pessoais"}</span></span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>
      {groups.map((group) => (
        <section key={group.title} aria-label={group.title} className="space-y-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h2>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {group.items.map((item, index) => (
              <Link key={item.label} to={item.href} className={`flex min-h-16 items-center gap-3 px-4 py-3 text-card-foreground transition-colors hover:bg-accent focus-visible:bg-accent ${index ? "border-t border-border/70" : ""}`}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><item.icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.label}</span><span className="block text-xs text-muted-foreground">{item.description}</span></span>
                {item.soon && <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">Em breve</span>}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      ))}
      <footer className="pb-4 text-center text-xs text-muted-foreground">FINNOS · Beta 1</footer>
    </main>
  );
}
