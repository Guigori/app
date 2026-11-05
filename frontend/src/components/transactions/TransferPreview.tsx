import { ArrowLeftRight, Wallet } from "lucide-react";
import { formatBRL, formatHiddenBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { transferBalances } from "@/lib/transferBalances";
import type { Account } from "@/types/finnos";

interface Side { account?: Account; balance: number }

interface Props {
  from?: Account;
  to?: Account;
  amount: number;
  hidden?: boolean;
  editing?: { fromId: string; toId: string | null; value: number } | null;
  onPickFrom?: () => void;
  onPickTo?: () => void;
  onSwap?: () => void;
}

/** "De" and "Para" with what each account will have after the transfer. */
export function TransferPreview({ from, to, amount, hidden = false, editing, onPickFrom, onPickTo, onSwap }: Props) {
  const after = transferBalances(from, to, amount, editing);
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));
  const card = (side: "De" | "Para", { account, balance }: Side, onPick?: () => void) => {
    const Tag = onPick ? "button" : "div";
    return (
      <Tag type={onPick ? "button" : undefined} onClick={onPick}
        className={cn("min-w-0 flex-1 rounded-2xl p-2.5 text-left transition-colors",
          account ? (side === "De" ? "bg-income/10" : "bg-primary/10") : "border-2 border-dashed border-border",
          onPick && "hover:brightness-95")}
        data-testid={side === "De" ? "transfer-from" : "transfer-to"}>
        <span className="flex items-center justify-between gap-2">
          <span className={cn("grid size-8 place-items-center rounded-xl", account ? (side === "De" ? "bg-income text-white" : "bg-primary text-primary-foreground") : "border border-dashed border-border")}>
            {account ? <Wallet className="h-4 w-4" aria-hidden="true" /> : null}
          </span>
          <span className="text-xs text-muted-foreground">{side}</span>
        </span>
        <span className="mt-1.5 block truncate font-semibold">{account?.name ?? "Escolha uma conta"}</span>
        {account ? (
          <>
            <span className="block text-[11px] text-muted-foreground">{side === "De" ? "restante" : "novo saldo"}</span>
            <span className={cn("block text-sm font-semibold tabular-nums", balance < 0 && "text-expense")} data-testid={side === "De" ? "transfer-from-after" : "transfer-to-after"}>{money(balance)}</span>
          </>
        ) : null}
      </Tag>
    );
  };
  return (
    <div data-testid="transfer-preview">
      <div className="relative flex items-stretch gap-2">
        {card("De", { account: from, balance: after.from }, onPickFrom)}
        {onSwap ? (
          <button type="button" onClick={onSwap} aria-label="Inverter contas" data-testid="transfer-swap"
            className="absolute left-1/2 top-1/2 z-10 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-border bg-card text-primary shadow-sm">
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
        {card("Para", { account: to, balance: after.to }, onPickTo)}
      </div>
      {from && amount > 0 && after.from < 0 ? (
        <p className="mt-2 rounded-xl bg-expense/10 px-3 py-2 text-xs text-expense" role="status" data-testid="transfer-negative">
          {from.name} fica negativa em {money(-after.from)} com esta transferência.
        </p>
      ) : null}
    </div>
  );
}
