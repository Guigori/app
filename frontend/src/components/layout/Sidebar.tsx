import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { LogOut, PanelLeftClose, PanelLeftOpen, Smartphone } from "lucide-react";
import { fetchMe } from "@/lib/data";
import { endSession } from "@/lib/session";
import { isLocalMode } from "@/lib/mode";
import { FinnosLogo } from "@/components/brand/FinnosLogo";
import { NavMenu } from "@/components/layout/NavMenu";
import { Button } from "@/components/ui/button";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

interface AccountBlockProps {
  compact?: boolean;
  /** Collapsed rail: avatar and sign-out only. */
  iconOnly?: boolean;
}

/** Profile + logout, shown at the top of the drawer and the bottom of the sidebar. */
export function AccountBlock({ compact, iconOnly }: AccountBlockProps) {
  const navigate = useNavigate();
  const local = isLocalMode();
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 5 * 60 * 1000 });
  if (!user) return null;

  const signOut = async () => {
    await endSession();
    navigate("/login");
  };
  if (iconOnly) {
    return (
      <div className="flex flex-col items-center gap-2" data-testid="account-block">
        <div title={user.name} className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 font-heading text-sm font-bold text-primary">
          {local ? <Smartphone className="h-4 w-4" aria-hidden="true" /> : initials(user.name)}
        </div>
        <Button variant="ghost" size="icon" onClick={signOut} aria-label={local ? "Sair da conta local" : "Sair da conta"} title="Sair" data-testid="sidebar-logout-button">
          <LogOut className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-muted/60 px-3 py-2.5" data-testid="account-block">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-heading text-sm font-bold text-primary">
        {local ? <Smartphone className="h-4 w-4" aria-hidden="true" /> : initials(user.name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
        <p className="truncate text-xs text-muted-foreground">{local ? "Conta local" : user.email}</p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={signOut}
        aria-label={local ? "Sair da conta local" : "Sair da conta"}
        data-testid={compact ? "drawer-logout-button" : "sidebar-logout-button"}
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

const COLLAPSED_KEY = "finnos:sidebar-collapsed";

function initialCollapsed(): boolean {
  try {
    const saved = window.localStorage.getItem(COLLAPSED_KEY);
    if (saved !== null) return saved === "1";
  } catch { /* storage unavailable */ }
  // Laptops (< 1280px) start with the icon rail so content gets the space.
  return window.innerWidth < 1280;
}

/** Desktop navigation: expandable (16rem) or icon rail (4.5rem), remembered per
 * device and toggled with the button or Ctrl/Cmd+B. Publishes --sidebar-w so the
 * shell content offset follows. */
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = useCallback(() => {
    setCollapsed((value) => {
      try { window.localStorage.setItem(COLLAPSED_KEY, value ? "0" : "1"); } catch { /* storage unavailable */ }
      return !value;
    });
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-w", collapsed ? "4.5rem" : "16rem");
  }, [collapsed]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-card transition-[width] duration-200 ease-out lg:flex"
      style={{ width: "var(--sidebar-w, 16rem)" }}
      data-collapsed={collapsed}
    >
      <div className={collapsed ? "flex justify-center px-2 pb-2 pt-5" : "px-5 pb-2 pt-6"}>
        <FinnosLogo iconOnly={collapsed} className={collapsed ? "h-9 w-9" : "w-32"} />
      </div>
      <div className={collapsed ? "flex-1 overflow-y-auto px-2 py-4" : "flex-1 overflow-y-auto px-3 py-4"} data-testid="sidebar-nav">
        <NavMenu animate={false} collapsed={collapsed} />
      </div>
      <div className="space-y-2 border-t border-border p-3">
        <AccountBlock iconOnly={collapsed} />
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          className={collapsed ? "w-full px-0" : "w-full justify-start gap-2 text-muted-foreground"}
          aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expandir menu (Ctrl+B)" : "Recolher menu (Ctrl+B)"}
          data-testid="sidebar-toggle"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <><PanelLeftClose className="h-4 w-4" aria-hidden="true" /> Recolher menu</>}
        </Button>
      </div>
    </aside>
  );
}
