import { useTheme } from "next-themes";
import { Eye, EyeOff, Menu, Moon, Sun } from "lucide-react";
import { FinnosLogo } from "@/components/brand/FinnosLogo";
import { NotificationsBell } from "@/components/layout/NotificationsBell";
import { Button } from "@/components/ui/button";
import { useBalanceHidden } from "@/lib/balance";

interface HeaderProps {
  /** The drawer lives in AppShell so the edge-swipe gesture can open it too. */
  onOpenMenu: () => void;
}

export function Header({ onOpenMenu }: HeaderProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const { hidden, toggle } = useBalanceHidden();

  return (
    <>
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b border-border bg-background/85 px-3 backdrop-blur sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenMenu}
            aria-label="Abrir menu de navegação"
            data-testid="open-nav-drawer"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
          <FinnosLogo />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <NotificationsBell />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={hidden ? "Exibir valores" : "Ocultar valores"}
            data-testid="header-visibility-toggle"
          >
            {hidden ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label={resolvedTheme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
            data-testid="theme-toggle-button"
          >
            {resolvedTheme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </Button>
        </div>
      </header>
    </>
  );
}
