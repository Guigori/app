import { useNavigate } from "react-router-dom";
import { Menu, MessageCircleMore, Search } from "lucide-react";
import { useNavigationPreferences } from "@/lib/navigationPreferences";
import { FinnosLogo } from "@/components/brand/FinnosLogo";
import { NotificationsBell } from "@/components/layout/NotificationsBell";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  /** The drawer lives in AppShell so the edge-swipe gesture can open it too. */
  onOpenMenu: () => void;
}

export function Header({ onOpenMenu }: HeaderProps) {
  const navigate = useNavigate();
  const aiVisible = useNavigationPreferences().aiMobile;

  return (
    <>
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-1 border-b border-border/70 bg-background/95 px-2 backdrop-blur-xl sm:h-14 sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11"
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
            className="h-11 w-11"
            onClick={() => window.dispatchEvent(new CustomEvent("finnos-search-open"))}
            aria-label="Buscar"
            data-testid="header-search-button"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </Button>
          {aiVisible ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 text-primary"
              onClick={() => window.dispatchEvent(new CustomEvent("finnos-ai-open"))}
              aria-label="Conversa"
              data-testid="header-ai-button"
            >
              <MessageCircleMore className="h-5 w-5" aria-hidden="true" />
            </Button>
          ) : null}
          <NotificationsBell />
        </div>
      </header>
    </>
  );
}
