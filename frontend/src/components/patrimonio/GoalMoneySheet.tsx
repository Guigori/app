import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, Loader2 } from "lucide-react";
import { createTransaction, deleteTransaction } from "@/lib/data";
import { updateGoal, type FinnosGoal } from "@/lib/goals";
import { contribute, moveBetweenGoals, withdraw } from "@/lib/goalProgress";
import { parseBRNumber } from "@/lib/registerParsing";
import { todayISO } from "@/lib/format";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { Account } from "@/types/finnos";

export type MoneyMode = "aporte" | "retirada";

interface Props {
  goal: FinnosGoal | null;
  goals: FinnosGoal[];
  accounts: Account[];
  userId: string;
  mode: MoneyMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  display: (n: number) => string;
}

/** Where the money comes from (or goes to): an account, another goal, or nowhere (already set aside). */
type Choice = { kind: "account"; id: string } | { kind: "goal"; id: string } | { kind: "none" };

/** Guardar or take money out of a goal, always saying where it comes from or goes. */
export function GoalMoneySheet({ goal, goals, accounts, userId, mode, open, onOpenChange, onDone, display }: Props) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [choice, setChoice] = useState<Choice>({ kind: "none" });
  const [note, setNote] = useState("");
  const [alsoTransfer, setAlsoTransfer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [side] = useState<"bottom" | "right">(() => (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches ? "right" : "bottom"));
  if (!goal) return null;

  const active = accounts.filter((a) => a.active !== false);
  const goalAccount = active.find((a) => a.id === goal.account);
  const others = goals.filter((g) => g.id !== goal.id && (mode === "aporte" ? g.saved > 0 : g.saved < g.target));
  const value = parseBRNumber(amount || "0");
  const room = mode === "aporte" ? Math.max(0, goal.target - goal.saved) : goal.saved;
  const chosenAccount = choice.kind === "account" ? active.find((a) => a.id === choice.id) : undefined;
  // A real transfer between accounts only makes sense when the goal keeps its money in another account.
  const canTransfer = Boolean(goalAccount && chosenAccount && goalAccount.id !== chosenAccount.id);
  const pick = (next: Choice) => { setChoice(next); if (next.kind !== "account") setAlsoTransfer(false); };

  async function save() {
    if (!goal || !(value > 0)) return;
    setBusy(true);
    const today = todayISO();
    const before: FinnosGoal[] = [goal];
    let createdTx: string | null = null;
    try {
      let moved = Math.min(value, room);
      if (choice.kind === "goal") {
        const other = goals.find((g) => g.id === choice.id)!;
        before.push(other);
        const [a, b, amountMoved] = mode === "aporte" ? moveBetweenGoals(other, goal, value, today) : moveBetweenGoals(goal, other, value, today);
        moved = amountMoved;
        await updateGoal(userId, a);
        await updateGoal(userId, b);
      } else {
        const accountId = choice.kind === "account" ? choice.id : null;
        const next = mode === "aporte"
          ? contribute(goal, value, today, { accountId, note: note.trim() || null })
          : withdraw(goal, value, today, { accountId, note: note.trim() || null });
        await updateGoal(userId, next);
        if (alsoTransfer && canTransfer && goalAccount && chosenAccount) {
          const created = await createTransaction({
            name: `Meta: ${goal.name}`, value: moved, type: "transferencia", status: "pago", date: today,
            account_id: mode === "aporte" ? chosenAccount.id : goalAccount.id,
            to_account_id: mode === "aporte" ? goalAccount.id : chosenAccount.id,
            card_id: null, category_id: null, fixed: false, recurrence: null, installment: false, total_installments: null,
            current_installment: null, adjusted_value: null, attachment: null, notes: note.trim() || null,
          });
          createdTx = created.id;
        }
      }
      await queryClient.invalidateQueries();
      onDone();
      onOpenChange(false);
      setAmount(""); setNote(""); setChoice({ kind: "none" }); setAlsoTransfer(false);
      toast.success(mode === "aporte" ? `${display(moved)} guardados em ${goal.name}.` : `${display(moved)} saíram de ${goal.name}.`, {
        action: {
          label: "Desfazer",
          onClick: () => void (async () => {
            for (const g of before) await updateGoal(userId, g);
            if (createdTx) await deleteTransaction(createdTx);
            await queryClient.invalidateQueries();
            onDone();
          })(),
        },
      });
    } catch {
      toast.error("Não foi possível salvar agora. Confira a meta antes de tentar de novo.");
    } finally {
      setBusy(false);
    }
  }

  const option = (key: string, selected: boolean, label: string, detail: string | null, onClick: () => void) => (
    <button key={key} type="button" onClick={onClick} aria-pressed={selected}
      className={cn("flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm", selected ? "border-primary bg-primary/5" : "border-border")}>
      <span className="font-medium">{label}</span>{detail ? <span className="text-xs tabular-nums text-muted-foreground">{detail}</span> : null}
    </button>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className={cn("gap-0 overflow-y-auto p-0", side === "bottom" ? "max-h-[90svh] rounded-t-3xl" : "w-full sm:max-w-md")} data-testid="goal-money-sheet">
        <div className="space-y-4 p-5 pb-8">
          <div className="flex min-h-10 flex-col justify-center pl-12">
            <SheetTitle className="flex items-center gap-2 font-heading text-lg font-bold">
              {mode === "aporte" ? <ArrowDownLeft className="h-5 w-5 text-income" aria-hidden="true" /> : <ArrowUpRight className="h-5 w-5 text-expense" aria-hidden="true" />}
              {mode === "aporte" ? `Guardar em ${goal.name}` : `Retirar ou mover de ${goal.name}`}
            </SheetTitle>
            <SheetDescription className="mt-1 text-xs">
              {mode === "aporte" ? `Faltam ${display(room)} para a meta.` : `A meta tem ${display(room)} guardados.`}
            </SheetDescription>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Valor</span>
            <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" aria-label="Valor"
              className="mt-1 h-12 w-full rounded-xl border border-border bg-background px-3 text-lg font-semibold tabular-nums" data-testid="goal-money-amount" />
            {value > room ? <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">Vou usar {display(room)}, o máximo {mode === "aporte" ? "que falta" : "que a meta tem"}.</span> : null}
          </label>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">{mode === "aporte" ? "De onde vem esse dinheiro?" : "Para onde vai esse dinheiro?"}</legend>
            {active.map((a) => option(`acc-${a.id}`, choice.kind === "account" && choice.id === a.id, a.name, display(a.balance), () => pick({ kind: "account", id: a.id })))}
            {others.map((g) => option(`goal-${g.id}`, choice.kind === "goal" && choice.id === g.id, `Meta: ${g.name}`, mode === "aporte" ? `tem ${display(g.saved)}` : `faltam ${display(g.target - g.saved)}`, () => pick({ kind: "goal", id: g.id })))}
            {option("none", choice.kind === "none", mode === "aporte" ? "Já estava guardado (só anotar)" : "Só tirar da meta (sem destino)", null, () => pick({ kind: "none" }))}
          </fieldset>

          {canTransfer ? (
            <label className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-sm">
              <input type="checkbox" checked={alsoTransfer} onChange={(e) => setAlsoTransfer(e.target.checked)} className="mt-0.5" data-testid="goal-money-transfer" />
              <span>Registrar também a transferência de {mode === "aporte" ? chosenAccount!.name : goalAccount!.name} para {mode === "aporte" ? goalAccount!.name : chosenAccount!.name}, que muda o saldo das contas.</span>
            </label>
          ) : null}

          {choice.kind !== "goal" ? (
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional): 13º, bônus, imprevisto…" aria-label="Nota" maxLength={120}
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" />
          ) : null}

          <p className="text-xs text-muted-foreground">
            {choice.kind === "goal" ? "O dinheiro muda de meta; nenhuma conta é movimentada." : alsoTransfer ? "A meta e as contas serão atualizadas." : "Só a meta muda; o saldo das contas fica como está."}
          </p>

          <button type="button" onClick={() => void save()} disabled={busy || !(value > 0) || room <= 0}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50" data-testid="goal-money-save">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{mode === "aporte" ? "Guardar" : "Confirmar"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
