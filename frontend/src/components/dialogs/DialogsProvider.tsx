import { createContext, lazy, Suspense, useCallback, useContext, useState, type ReactNode } from "react";
import type { Account, Category, Transaction, TxType } from "@/types/finnos";

// Each form loads the first time it is opened, not with the app.
const AccountDialog = lazy(() => import("@/components/accounts/AccountDialog").then((m) => ({ default: m.AccountDialog })));
const CategoryDialog = lazy(() => import("@/components/categories/CategoryDialog").then((m) => ({ default: m.CategoryDialog })));
const TransactionDialog = lazy(() => import("@/components/transactions/TransactionDialog").then((m) => ({ default: m.TransactionDialog })));

export interface TransactionDialogInit {
  type?: TxType;
  transaction?: Transaction;
  /** Pre-fills the date — the calendar day the user has selected, for instance. */
  date?: string;
  /** Pending offline operation being reviewed after a sync failure. */
  syncOperationId?: string;
  syncPayload?: import("@/types/finnos").TransactionInput;
  firstAttemptAt?: string;
}

export interface CategoryDialogInit {
  category?: Category;
  /** Opens the dialog for a category the caller only knows by id (budget page). */
  categoryId?: string;
  group?: Category["group"];
}

interface DialogsApi {
  openTransaction: (init?: TransactionDialogInit) => void;
  openAccount: (account?: Account) => void;
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
  const [account, setAccount] = useState<{ open: boolean; account?: Account }>({ open: false });
  const [category, setCategory] = useState<{ open: boolean } & CategoryDialogInit>({ open: false });

  // Once opened, a form stays mounted so its closing animation still plays.
  const [seen, setSeen] = useState({ tx: false, account: false, category: false });
  const openTransaction = useCallback(
    (init?: TransactionDialogInit) => { setSeen((s) => ({ ...s, tx: true })); setTx({ open: true, ...init }); },
    [],
  );
  const openAccount = useCallback(
    (acct?: Account) => { setSeen((s) => ({ ...s, account: true })); setAccount({ open: true, account: acct }); },
    [],
  );
  const openCategory = useCallback(
    (init?: CategoryDialogInit) => { setSeen((s) => ({ ...s, category: true })); setCategory({ open: true, ...init }); },
    [],
  );

  return (
    <DialogsContext.Provider value={{ openTransaction, openAccount, openCategory }}>
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
      /> : null}
      {seen.account ? <AccountDialog
        open={account.open}
        onOpenChange={(open) => setAccount((prev) => ({ ...prev, open }))}
        account={account.account}
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
