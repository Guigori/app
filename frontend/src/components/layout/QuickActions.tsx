import { useLocation } from "react-router-dom";
import { ArrowDownCircle, ArrowLeftRight, ArrowUpCircle, Repeat, Target, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { getSelectedDay } from "@/lib/selectedDay";
import { useDialogs } from "@/components/dialogs/DialogsProvider";

export interface QuickAction {
  label: string;
  icon: LucideIcon;
  testid: string;
  onClick?: () => void;
  soon?: boolean;
}

/** The "+" menu, shared by the mobile central button and the desktop FAB. */
export function useQuickActions(): { actions: QuickAction[]; run: (action: QuickAction) => void } {
  const dialogs = useDialogs();
  const location = useLocation();
  // Read at click time, not at render: the selected day changes without remounting this.
  const pickedDate = () =>
    location.pathname === "/transacoes" ? (getSelectedDay() ?? undefined) : undefined;

  const actions: QuickAction[] = [
    { label: "Nova transação", icon: ArrowLeftRight, testid: "fab-new-transaction", onClick: () => dialogs.openTransaction({ date: pickedDate() }) },
    { label: "Nova receita", icon: ArrowUpCircle, testid: "fab-new-income", onClick: () => dialogs.openTransaction({ type: "receita", date: pickedDate() }) },
    { label: "Nova despesa", icon: ArrowDownCircle, testid: "fab-new-expense", onClick: () => dialogs.openTransaction({ type: "despesa", date: pickedDate() }) },
    {
      label: "Nova transferência",
      icon: ArrowLeftRight,
      testid: "fab-new-transfer",
      onClick: () => dialogs.openTransaction({ type: "transferencia", date: pickedDate() }),
    },
    { label: "Nova assinatura", icon: Repeat, testid: "fab-new-subscription", soon: true },
    { label: "Nova meta", icon: Target, testid: "fab-new-goal", soon: true },
  ];

  const run = (action: QuickAction) => {
    if (action.soon) {
      toast.info("Em breve — este módulo chega em uma próxima entrega do FINNOS.");
      return;
    }
    action.onClick?.();
  };

  return { actions, run };
}
