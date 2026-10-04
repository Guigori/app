import { useTheme } from "next-themes";
import { useNavigate } from "react-router-dom";
import { Menu, Moon, Sun } from "lucide-react";
import { FinnosLogo } from "@/components/brand/FinnosLogo";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  /** The drawer lives in AppShell so the edge-swipe gesture can open it too. */
  onOpenMenu: () => void;
}

export function Header({ onOpenMenu }: HeaderProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const navigate = useNavigate();

  return (
    <>
      <header className="sticky top-0 z-20 flex h-12 items-center justify-between gap-1 border-b border-border/70 bg-background/95 px-2 backdrop-blur-xl sm:h-14 sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenMenu}
            aria-label="Abrir menu de navegação"
            data-testid="open-nav-drawer"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
          <button type="button" onClick={() => navigate("/")} aria-label="Voltar para o início" className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <FinnosLogo className="w-32 sm:w-36" />
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-0 sm:gap-1">
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
