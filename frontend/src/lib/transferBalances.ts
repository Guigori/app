import type { Account } from "@/types/finnos";

/**
 * Balances after a transfer: the source loses the amount, the destination gains it. When an
 * existing transfer is being edited, `editing` is taken out of the balances first, so it is not counted twice.
 */
export function transferBalances(from: Account | undefined, to: Account | undefined, amount: number, editing?: { fromId: string; toId: string | null; value: number } | null) {
  const base = (a: Account | undefined) => {
    if (!a) return 0;
    if (!editing) return a.balance;
    return a.balance + (a.id === editing.fromId ? editing.value : 0) - (a.id === editing.toId ? editing.value : 0);
  };
  return { from: base(from) - amount, to: base(to) + amount, fromBefore: base(from), toBefore: base(to) };
}
