/** Saves a FINNOS IA proposal the user confirmed, and undoes it. Every write goes through lib/data. */
import { createSubscription, createTransaction, deleteSubscription, deleteTransaction, fetchTransaction, updateTransaction } from "@/lib/data";
import type { Proposal, ProposalState } from "@/lib/finnActions";
import { todayISO } from "@/lib/format";
import type { Transaction, TransactionInput } from "@/types/finnos";

const asInput = (tx: Transaction, over: Partial<TransactionInput> = {}): TransactionInput => ({
  name: tx.name, value: tx.value, type: tx.type, status: tx.status, date: tx.date, account_id: tx.account_id,
  card_id: tx.card_id, to_account_id: tx.to_account_id, category_id: tx.category_id, fixed: tx.fixed,
  recurrence: tx.recurrence, installment: tx.installment, total_installments: tx.total_installments,
  current_installment: tx.current_installment, adjusted_value: tx.adjusted_value, attachment: tx.attachment,
  notes: tx.notes, ...over,
});

async function recategorize(ids: string[], to: (tx: Transaction) => string | null): Promise<{ id: string; categoryId: string | null }[]> {
  const previous: { id: string; categoryId: string | null }[] = [];
  for (const id of ids) {
    const tx = await fetchTransaction(id);
    if (!tx) continue;
    previous.push({ id, categoryId: tx.category_id });
    await updateTransaction(id, asInput(tx, { category_id: to(tx) }), "manual", tx.version);
  }
  return previous;
}

/** Applies what is still included; returns what is needed to undo it. */
export async function applyProposal(proposal: Proposal): Promise<Extract<ProposalState, { status: "applied" }>> {
  if (proposal.kind === "register") {
    const createdIds: string[] = [];
    for (const e of proposal.entries.filter((x) => x.include)) {
      const today = todayISO();
      const created = await createTransaction({
        name: e.name, value: e.value, type: e.type, status: e.date > today ? "agendado" : "pago", date: e.date,
        account_id: e.accountId, card_id: null, to_account_id: null, category_id: e.categoryId, fixed: false,
        recurrence: null, installment: false, total_installments: null, current_installment: null,
        adjusted_value: null, attachment: null, notes: null,
      });
      createdIds.push(created.id);
    }
    return { status: "applied", createdIds };
  }
  if (proposal.kind === "recategorize") {
    return { status: "applied", previous: await recategorize(proposal.ids, () => proposal.toCategoryId) };
  }
  const subscriptionIds: string[] = [];
  for (const c of proposal.candidates.filter((x) => x.include)) {
    const created = await createSubscription({
      name: c.name, value: c.value, recurrence: "mensal", next_charge: c.nextCharge, account_id: c.accountId,
      category_id: c.categoryId, card_id: c.cardId, active: true, notes: null,
    });
    subscriptionIds.push(created.id);
  }
  return { status: "applied", subscriptionIds };
}

/** Puts things back as they were before the proposal was applied. */
export async function undoProposal(state: Extract<ProposalState, { status: "applied" }>): Promise<void> {
  for (const id of state.createdIds ?? []) await deleteTransaction(id);
  if (state.previous?.length) {
    const before = new Map(state.previous.map((p) => [p.id, p.categoryId]));
    await recategorize([...before.keys()], (tx) => before.get(tx.id) ?? null);
  }
  for (const id of state.subscriptionIds ?? []) await deleteSubscription(id);
}
