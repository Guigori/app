import { X } from "lucide-react";
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
      <SheetContent side="left" showCloseButton={false} className="flex w-[20.25rem] max-w-[86vw] flex-col gap-2.5 overflow-y-auto border-r border-border bg-[#FBFAFF] p-4 dark:bg-background pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl" data-testid="nav-drawer">
        <SheetHeader className="flex h-11 flex-row items-center justify-between p-0 pl-1 text-left">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <FinnosLogo className="w-32" />
          <button type="button" onClick={() => onOpenChange(false)} aria-label="Fechar menu" data-testid="nav-drawer-close"
            className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card text-foreground hover:bg-muted">
            <X className="size-5" aria-hidden="true" />
          </button>
          <SheetDescription className="sr-only">Perfil, busca, seções do FINNOS e configurações</SheetDescription>
        </SheetHeader>
        <NavMenu surface="mobile" onNavigate={() => onOpenChange(false)} testidPrefix="drawer-nav" />
      </SheetContent>
    </Sheet>
  );
}
