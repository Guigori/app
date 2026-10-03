import { Plus } from "lucide-react";
import { useQuickActions } from "@/components/layout/QuickActions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Dashboard floating "+": on mobile the central button in the bottom bar owns it. */
export function QuickActionFAB() {
  const { actions, run } = useQuickActions();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="fixed bottom-4 right-4 dashboard:md:bottom-8 dashboard:md:right-6 z-40 hidden h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-xl active:scale-95 dashboard:flex"
        aria-label="Adicionar lançamento"
        data-testid="quick-action-fab"
      >
        <Plus className="h-6 w-6" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-60 p-2" data-testid="quick-action-menu">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.testid}
            onClick={() => run(action)}
            className={cn(
              "gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              action.testid === "fab-new-transaction" && "bg-primary/5 text-primary",
            )}
            data-testid={action.testid}
          >
            <action.icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
