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
      <SheetContent side="left" className="flex w-[20rem] max-w-[86vw] flex-col gap-3 overflow-y-auto border-r border-white/10 bg-background/82 p-3 shadow-2xl backdrop-blur-2xl supports-[backdrop-filter]:bg-background/72 dashboard:w-[21rem] dashboard:max-w-[88vw] dashboard:gap-4 dashboard:p-4" data-testid="nav-drawer">
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
