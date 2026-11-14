import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { LogOut, MessageCircleMore, Moon, Search, Settings, Smartphone, Sun } from "lucide-react";
import { fetchMe } from "@/lib/data";
import { isLocalMode } from "@/lib/mode";
import { menuFor, useNavigationPreferences } from "@/lib/navigationPreferences";
import { useMenuBadges, type MenuBadge } from "@/lib/menuBadges";
import { useSignOut } from "@/lib/useSignOut";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { cn } from "@/lib/utils";

interface NavMenuProps {
  /** Called after choosing a destination (the drawer closes itself). */
  onNavigate?: () => void;
  /** Phone drawer or computer sidebar: each has its own choices of what shows. */
  surface?: "mobile" | "web";
  animate?: boolean;
  testidPrefix?: string;
  /** Computer sidebar folded to icons. */
  collapsed?: boolean;
}

// oxlint-disable-next-line react/only-export-components
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

const BADGE_TONE: Record<MenuBadge["tone"], string> = {
  alert: "bg-[#FDECEC] text-[#BE123C] dark:bg-[#BE123C]/20 dark:text-[#FB7185]",
  warn: "bg-[#FFF1E6] text-[#C2410C] dark:bg-[#C2410C]/20 dark:text-[#FDBA74]",
  info: "text-muted-foreground",
};
const DOT_TONE: Record<MenuBadge["tone"], string> = { alert: "bg-[#BE123C]", warn: "bg-[#C2410C]", info: "" };

/** You: the profile opens Meu perfil, the button beside it signs out (after asking). */
function ProfileCard({ collapsed, onNavigate, testidPrefix }: { collapsed: boolean; onNavigate?: () => void; testidPrefix: string }) {
  const local = isLocalMode();
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 5 * 60 * 1000 });
  const signOut = useSignOut();
  const [confirm, setConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  if (!user) return null;
  const avatar = (
    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 font-heading text-sm font-bold text-primary dark:text-[#B3A6FF]">
      {local ? <Smartphone className="size-4" aria-hidden="true" /> : initials(user.name)}
    </span>
  );
  return (
    <>
      <div className={cn("flex overflow-hidden rounded-2xl", collapsed ? "flex-col items-center gap-2" : "border border-border bg-card")} data-testid="account-block">
        <Link to="/perfil" onClick={onNavigate} title={collapsed ? `${user.name} · Meu perfil` : undefined}
          className={cn("flex min-w-0 flex-1 items-center gap-3 text-foreground", collapsed ? "justify-center" : "p-3 hover:bg-muted/60")}
          data-testid={`${testidPrefix}-profile`}>
          {avatar}
          {collapsed ? null : (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{local ? "Conta neste aparelho" : "Ver meu perfil"}</span>
            </span>
          )}
        </Link>
        {collapsed ? null : (
          <button type="button" onClick={() => setConfirm(true)} aria-label={local ? "Sair da conta local" : "Sair da conta"} title="Sair da conta"
            className="grid w-12 shrink-0 place-items-center border-l border-border text-[#BE123C] hover:bg-[#FDECEC] dark:text-[#FB7185] dark:hover:bg-[#BE123C]/15"
            data-testid={`${testidPrefix}-logout`}>
            <LogOut className="size-[1.1rem]" aria-hidden="true" />
          </button>
        )}
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Sair da conta?"
        description={local ? "Os dados deste aparelho continuam salvos nele." : "Para voltar, é só entrar de novo. Nada é apagado."}
        confirmLabel="Sair" destructive loading={leaving}
        onConfirm={async () => { setLeaving(true); try { await signOut(); } finally { setLeaving(false); setConfirm(false); } }} />
    </>
  );
}

/**
 * The menu, on the phone drawer and the computer sidebar: who you are, Conversa and Buscar, the
 * places to go (each person chooses which show), and Configurações with the theme at the end.
 */
export function NavMenu({ onNavigate, surface = "mobile", animate = true, testidPrefix = "nav", collapsed = false }: NavMenuProps) {
  const location = useLocation();
  const prefs = useNavigationPreferences();
  const groups = menuFor(prefs, surface);
  const badges = useMenuBadges(prefs.menuBadges);
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const conversa = surface === "mobile" ? prefs.aiMobile : prefs.aiWeb;
  let index = -1;

  const action = "flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm transition-colors";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ProfileCard collapsed={collapsed} onNavigate={onNavigate} testidPrefix={testidPrefix} />

      <div className={cn("flex gap-2", collapsed && "flex-col")}>
        {conversa ? (
          <button type="button" onClick={() => { onNavigate?.(); window.dispatchEvent(new CustomEvent("finnos-ai-open")); }}
            title={collapsed ? "Conversa" : undefined} aria-label="Conversa"
            className={cn(action, "bg-primary/10 font-bold text-primary hover:bg-primary/15 dark:text-[#B3A6FF]")} data-testid={`${testidPrefix}-conversa`}>
            <MessageCircleMore className="size-[1.15rem] shrink-0" aria-hidden="true" />{collapsed ? null : "Conversa"}
          </button>
        ) : null}
        <button type="button" onClick={() => { onNavigate?.(); window.dispatchEvent(new CustomEvent("finnos-search-open")); }}
          title={collapsed ? "Buscar (Ctrl+K)" : "Buscar em tudo (Ctrl+K)"} aria-label="Buscar"
          className={cn(action, "border border-border bg-card font-semibold text-foreground hover:bg-muted")} data-testid={`${testidPrefix}-buscar`}>
          <Search className="size-[1.15rem] shrink-0" aria-hidden="true" />{collapsed ? null : "Buscar"}
        </button>
      </div>

      <nav className="flex flex-col gap-1" aria-label="Seções" data-testid={`${testidPrefix}-menu`}>
        {groups.map((group) => (
          <div key={group.label ?? "principal"}>
            {group.label && collapsed ? (
              <div className="mx-auto my-2.5 h-px w-6 bg-border" aria-hidden="true" />
            ) : group.label ? (
              <p className="mb-1 mt-3 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{group.label}</p>
            ) : null}
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                index += 1;
                const delay = animate ? Math.min(index, 12) * 0.025 : 0;
                const badge = badges[item.slug];
                return (
                  <motion.div key={item.to} initial={animate ? { opacity: 0, x: -10 } : false} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
                    <NavLink
                      to={item.to}
                      end={item.to === "/"}
                      onClick={() => onNavigate?.()}
                      title={collapsed ? (badge ? `${item.label} · ${badge.text}` : item.label) : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      className={({ isActive: routeActive }) => {
                        const isActive = routeActive || (item.to === "/transacoes" && location.pathname.startsWith("/fluxo"));
                        return cn(
                          "relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-[0.95rem] transition-colors duration-150",
                          collapsed && "justify-center px-0",
                          isActive ? "bg-primary/10 font-bold text-primary dark:text-[#B3A6FF]" : "font-medium text-foreground/80 hover:bg-muted hover:text-foreground",
                        );
                      }}
                      data-testid={`${testidPrefix}-${item.slug}`}
                    >
                      <span className="relative grid shrink-0 place-items-center" aria-hidden="true">
                        <item.icon className="size-[1.25rem]" />
                        {collapsed && badge && badge.tone !== "info" ? (
                          <span className={cn("absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-card", DOT_TONE[badge.tone])} />
                        ) : null}
                      </span>
                      {collapsed ? null : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                      {!collapsed && badge ? (
                        <span className={cn("shrink-0 rounded-full text-[11px] font-bold", badge.tone === "info" ? "text-xs font-medium" : "px-2 py-0.5", BADGE_TONE[badge.tone])}
                          data-testid={`${testidPrefix}-${item.slug}-badge`}>{badge.text}</span>
                      ) : null}
                    </NavLink>
                  </motion.div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className={cn("mt-auto flex gap-2 border-t border-border pt-3", collapsed && "flex-col items-center")}>
        <NavLink to="/configuracoes" onClick={() => onNavigate?.()} title={collapsed ? "Configurações" : undefined} aria-label="Configurações"
          className={({ isActive }) => cn("flex h-11 min-w-0 items-center gap-2.5 rounded-xl border border-border px-3 text-sm font-semibold transition-colors",
            collapsed ? "w-11 justify-center px-0" : "flex-1",
            isActive ? "bg-primary/10 text-primary dark:text-[#B3A6FF]" : "bg-card text-foreground hover:bg-muted")}
          data-testid={`${testidPrefix}-configuracoes`}>
          <Settings className="size-[1.1rem] shrink-0" aria-hidden="true" />{collapsed ? null : "Configurações"}
        </NavLink>
        <button type="button" onClick={() => setTheme(dark ? "light" : "dark")}
          aria-label={dark ? "Usar tema claro" : "Usar tema escuro"} title={dark ? "Usar tema claro" : "Usar tema escuro"}
          className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-card text-foreground hover:bg-muted"
          data-testid="theme-toggle-button">
          {dark ? <Sun className="size-[1.1rem]" aria-hidden="true" /> : <Moon className="size-[1.1rem]" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
