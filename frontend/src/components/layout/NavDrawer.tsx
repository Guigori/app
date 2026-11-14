import { FinnosLogo } from "@/components/brand/FinnosLogo";
import { NavMenu } from "@/components/layout/NavMenu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface NavDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The phone menu, slid in from the left: same menu as the computer sidebar, minus the bottom-bar tabs. */
export function NavDrawer({ open, onOpenChange }: NavDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" showCloseButton className="flex w-[20.5rem] max-w-[86vw] flex-col gap-3 overflow-y-auto border-r border-border bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl" data-testid="nav-drawer">
        <SheetHeader className="flex h-11 flex-row items-center p-0 pl-12 text-left">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <FinnosLogo className="w-32" />
          <SheetDescription className="sr-only">Perfil, busca, seções do FINNOS e configurações</SheetDescription>
        </SheetHeader>
        <NavMenu surface="mobile" onNavigate={() => onOpenChange(false)} testidPrefix="drawer-nav" />
      </SheetContent>
    </Sheet>
  );
}
