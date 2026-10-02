import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { LogOut, Smartphone } from "lucide-react";
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
}

/** Profile + logout, shown at the top of the drawer and the bottom of the sidebar. */
export function AccountBlock({ compact }: AccountBlockProps) {
  const navigate = useNavigate();
  const local = isLocalMode();
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 5 * 60 * 1000 });
  if (!user) return null;

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
        onClick={async () => {
          await endSession();
          navigate("/login");
        }}
        aria-label={local ? "Sair da conta local" : "Sair da conta"}
        data-testid={compact ? "drawer-logout-button" : "sidebar-logout-button"}
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

/** Desktop rail: logo, grouped Calen-style navigation, account block. */
export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-border bg-card lg:flex">
      <div className="px-6 pb-2 pt-6">
        <FinnosLogo />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4" data-testid="sidebar-nav">
        <NavMenu />
      </div>
      <div className="border-t border-border p-3">
        <AccountBlock />
      </div>
    </aside>
  );
}
