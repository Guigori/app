import { NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Smartphone } from "lucide-react";
import { fetchMe } from "@/lib/data";
import { cn } from "@/lib/utils";
import { endSession } from "@/lib/session";
import { isLocalMode } from "@/lib/mode";
import { FinnosLogo } from "@/components/brand/FinnosLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MAIN_NAV, SETTINGS_NAV } from "@/components/layout/nav";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

export function Sidebar() {
  const navigate = useNavigate();
  const local = isLocalMode();
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 5 * 60 * 1000 });

  const handleLogout = async () => {
    await endSession();
    navigate("/login");
  };

  const renderItem = (item: (typeof MAIN_NAV)[number]) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-200",
          isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )
      }
      data-testid={`nav-${item.slug}`}
    >
      <item.icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
      <span className="flex-1">{item.label}</span>
      {item.soon ? <Badge variant="outline" className="text-[10px] text-muted-foreground">Em breve</Badge> : null}
    </NavLink>
  );

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-card lg:flex">
      <div className="px-6 pt-6">
        <FinnosLogo />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-6" data-testid="sidebar-nav">
        {MAIN_NAV.map(renderItem)}
      </nav>

      <div className="border-t border-border px-3 py-4">
        {SETTINGS_NAV.map(renderItem)}
        {user ? (
          <div className="mt-3 flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
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
              onClick={handleLogout}
              aria-label={local ? "Sair da conta local" : "Sair da conta"}
              data-testid="sidebar-logout-button"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
