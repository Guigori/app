import { FinnosLogo } from "@/components/brand/FinnosLogo";
import { AccountBlock } from "@/components/layout/Sidebar";
import { NavMenu } from "@/components/layout/NavMenu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface NavDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The hamburger drawer: same grouped navigation as the sidebar, slid in from the left. */
export function NavDrawer({ open, onOpenChange }: NavDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex w-[21rem] max-w-[88vw] flex-col gap-4 overflow-y-auto p-4" data-testid="nav-drawer">
        <SheetHeader className="space-y-3 p-0 text-left">
          <SheetTitle className="sr-only">Navegação</SheetTitle>
          <FinnosLogo />
          <SheetDescription className="sr-only">Navegação do FINNOS</SheetDescription>
          <AccountBlock compact />
        </SheetHeader>
        <NavMenu onNavigate={() => onOpenChange(false)} testidPrefix="drawer-nav" />
      </SheetContent>
    </Sheet>
  );
}
