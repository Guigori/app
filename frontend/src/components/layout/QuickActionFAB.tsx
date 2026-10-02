import {
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  Plus,
  Repeat,
  Target,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface FabAction {
  label: string;
  icon: LucideIcon;
  testid: string;
  onClick?: () => void;
  soon?: boolean;
}

export function QuickActionFAB() {
  const dialogs = useDialogs();

  // A menu (not a popover) so selecting an item closes it natively — a controlled popover
  // re-opened when focus returned to the trigger after the dialog closed.
  const actions: FabAction[] = [
    { label: "Nova transação", icon: ArrowLeftRight, testid: "fab-new-transaction", onClick: () => dialogs.openTransaction() },
    { label: "Nova receita", icon: ArrowUpCircle, testid: "fab-new-income", onClick: () => dialogs.openTransaction({ type: "receita" }) },
    { label: "Nova despesa", icon: ArrowDownCircle, testid: "fab-new-expense", onClick: () => dialogs.openTransaction({ type: "despesa" }) },
    { label: "Nova transferência", icon: ArrowLeftRight, testid: "fab-new-transfer", onClick: () => dialogs.openTransaction({ type: "transferencia" }) },
    { label: "Nova assinatura", icon: Repeat, testid: "fab-new-subscription", soon: true },
    { label: "Nova meta", icon: Target, testid: "fab-new-goal", soon: true },
  ];

  const handleAction = (action: FabAction) => {
    if (action.soon) {
      toast.info("Em breve — este módulo chega em uma próxima entrega do FINNOS.");
      return;
    }
    action.onClick?.();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 transition-transform duration-200 hover:scale-105 active:scale-100 lg:bottom-8 lg:right-8"
        aria-label="Adicionar lançamento"
        data-testid="quick-action-fab"
      >
        <Plus className="h-6 w-6" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-60 p-2" data-testid="quick-action-menu">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.testid}
            onClick={() => handleAction(action)}
            className={cn(
              "gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
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
