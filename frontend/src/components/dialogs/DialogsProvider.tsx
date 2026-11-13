import { createContext, Suspense, useCallback, useContext, useState, type ReactNode } from "react";
import { lazyRetry } from "@/lib/lazyRetry";
import { openRegisterSheet, opensInRegister } from "@/lib/registerSheet";
import type { Account, Category, Transaction, TxType } from "@/types/finnos";

// Each form loads the first time it is opened, not with the app.
const AccountDialog = lazyRetry(() => import("@/components/accounts/AccountDialog").then((m) => ({ default: m.AccountDialog })));
const CategoryDialog = lazyRetry(() => import("@/components/categories/CategoryDialog").then((m) => ({ default: m.CategoryDialog })));
const TransactionDetailSheet = lazyRetry(() => import("@/components/transactions/TransactionDetailSheet").then((m) => ({ default: m.TransactionDetailSheet })));
const TransactionDialog = lazyRetry(() => import("@/components/transactions/TransactionDialog").then((m) => ({ default: m.TransactionDialog })));

export interface TransactionDialogInit {
  type?: TxType;
  transaction?: Transaction;
  /** Pre-fills the date — the calendar day the user has selected, for instance. */
  date?: string;
  /** Pending offline operation being reviewed after a sync failure. */
  syncOperationId?: string;
  syncPayload?: import("@/types/finnos").TransactionInput;
  firstAttemptAt?: string;
  /** Fields to start a new one with (a transfer from this account, for instance). */
  prefill?: Partial<import("@/types/finnos").TransactionInput>;
}

export interface CategoryDialogInit {
  category?: Category;
  /** Opens the dialog for a category the caller only knows by id (budget page). */
  categoryId?: string;
  group?: Category["group"];
}

interface DialogsApi {
  openTransaction: (init?: TransactionDialogInit) => void;
  /** What a lançamento means (budget, recurrence, impact); editing is one action inside it. */
  /** The list it was opened from lets the register swipe to the previous and next ones. */
  openTransactionDetail: (transaction: Transaction, siblings?: Transaction[]) => void;
  /** ``type`` starts a new one as that kind (the Carteira "+": Banco, Benefício or Dinheiro). */
  openAccount: (account?: Account, init?: { type?: import("@/types/finnos").AccountType }) => void;
  openCategory: (init?: CategoryDialogInit) => void;
}

const DialogsContext = createContext<DialogsApi | null>(null);

// Shared with other components on purpose (tiny helper next to its only user).
// oxlint-disable-next-line react/only-export-components
export function useDialogs(): DialogsApi {
  const ctx = useContext(DialogsContext);
  if (!ctx) throw new Error("useDialogs deve ser usado dentro de DialogsProvider");
  return ctx;
}

interface TxState extends TransactionDialogInit {
  open: boolean;
}

export function DialogsProvider({ children }: { children: ReactNode }) {
  const [tx, setTx] = useState<TxState>({ open: false });
  const [account, setAccount] = useState<{ open: boolean; account?: Account; type?: import("@/types/finnos").AccountType }>({ open: false });
  const [category, setCategory] = useState<{ open: boolean } & CategoryDialogInit>({ open: false });

  // Once opened, a form stays mounted so its closing animation still plays.
  const [detail, setDetail] = useState<{ open: boolean; transaction: Transaction | null }>({ open: false, transaction: null });
  const [seen, setSeen] = useState({ tx: false, detail: false, account: false, category: false });
  const openTransaction = useCallback(
    (init?: TransactionDialogInit) => {
      // Editing a lançamento happens in the register screen, like creating one.
      if (init?.transaction && !init.syncOperationId && opensInRegister(init.transaction)) { openRegisterSheet({ existing: init.transaction }); return; }
      setSeen((s) => ({ ...s, tx: true })); setTx({ open: true, ...init });
    },
    [],
  );
  const openTransactionDetail = useCallback(
    (transaction: Transaction, siblings?: Transaction[]) => {
      // A saved lançamento opens in the register screen: its fields, its impact and the receipt below.
      if (opensInRegister(transaction)) { openRegisterSheet({ existing: transaction, siblings: siblings?.filter(opensInRegister) }); return; }
      setSeen((s) => ({ ...s, detail: true })); setDetail({ open: true, transaction });
    },
    [],
  );
  const openAccount = useCallback(
    (acct?: Account, init?: { type?: import("@/types/finnos").AccountType }) => { setSeen((s) => ({ ...s, account: true })); setAccount({ open: true, account: acct, type: init?.type }); },
    [],
  );
  const openCategory = useCallback(
    (init?: CategoryDialogInit) => { setSeen((s) => ({ ...s, category: true })); setCategory({ open: true, ...init }); },
    [],
  );

  return (
    <DialogsContext.Provider value={{ openTransaction, openTransactionDetail, openAccount, openCategory }}>
      {children}
      <Suspense fallback={null}>
      {seen.tx ? <TransactionDialog
        open={tx.open}
        onOpenChange={(open) => setTx((prev) => ({ ...prev, open }))}
        initialType={tx.type}
        initialDate={tx.date}
        transaction={tx.transaction}
        syncOperationId={tx.syncOperationId}
        syncPayload={tx.syncPayload}
        firstAttemptAt={tx.firstAttemptAt}
        prefill={tx.prefill}
      /> : null}
      {seen.detail ? <TransactionDetailSheet
        open={detail.open}
        onOpenChange={(open) => setDetail((prev) => ({ ...prev, open }))}
        transaction={detail.transaction}
        onEdit={(transaction) => openTransaction({ transaction })}
      /> : null}
      {seen.account ? <AccountDialog
        open={account.open}
        onOpenChange={(open) => setAccount((prev) => ({ ...prev, open }))}
        account={account.account}
        initialType={account.type}
      /> : null}
      {seen.category ? <CategoryDialog
        open={category.open}
        onOpenChange={(open) => setCategory((prev) => ({ ...prev, open }))}
        category={category.category}
        categoryId={category.categoryId}
        defaultGroup={category.group}
      /> : null}
      </Suspense>
    </DialogsContext.Provider>
  );
}
