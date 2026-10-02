import { useState } from "react";
import { NavLink } from "react-router-dom";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MAIN_NAV, SETTINGS_NAV, type NavItem } from "@/components/layout/nav";

const MOBILE_ITEMS = MAIN_NAV.filter((item) => !item.soon).slice(0, 3);

function NavButton({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          isActive ? "bg-primary/5 text-primary" : "text-muted-foreground hover:bg-muted",
        )
      }
      data-testid={`mobile-nav-${item.slug}`}
    >
      <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      {item.label}
    </NavLink>
  );
}

export function MobileNav() {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
        data-testid="mobile-nav"
      >
        {MOBILE_ITEMS.map((item) => (
          <MobileTab key={item.to} item={item} />
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex flex-col items-center gap-1 py-2.5 text-xs font-medium text-muted-foreground"
          aria-label="Abrir mais seções"
          data-testid="mobile-nav-more-button"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
          Mais
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="right" className="w-72 p-4">
          <SheetHeader className="text-left">
            <SheetTitle className="font-heading">Navegação</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-1">
            {MAIN_NAV.map((item) => (
              <NavButton key={item.to} item={item} onNavigate={() => setMoreOpen(false)} />
            ))}
            <div className="my-2 border-t border-border" />
            {SETTINGS_NAV.map((item) => (
              <NavButton key={item.to} item={item} onNavigate={() => setMoreOpen(false)} />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function MobileTab({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        cn(
          "flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors",
          isActive ? "text-primary" : "text-muted-foreground",
        )
      }
      data-testid={`mobile-nav-${item.slug}`}
    >
      <item.icon className="h-5 w-5" aria-hidden="true" />
      {item.label}
    </NavLink>
  );
}
