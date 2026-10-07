import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Account, Category, Transaction, TxType } from "@/types/finnos";
import { AccountDialog } from "@/components/accounts/AccountDialog";
import { CategoryDialog } from "@/components/categories/CategoryDialog";
import { TransactionDialog } from "@/components/transactions/TransactionDialog";

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

  const openTransaction = useCallback(
    (init?: TransactionDialogInit) => setTx({ open: true, ...init }),
    [],
  );
  const openAccount = useCallback(
    (acct?: Account) => setAccount({ open: true, account: acct }),
    [],
  );
  const openCategory = useCallback(
    (init?: CategoryDialogInit) => setCategory({ open: true, ...init }),
    [],
  );

  return (
    <DialogsContext.Provider value={{ openTransaction, openAccount, openCategory }}>
      {children}
      <TransactionDialog
        open={tx.open}
        onOpenChange={(open) => setTx((prev) => ({ ...prev, open }))}
        initialType={tx.type}
        initialDate={tx.date}
        transaction={tx.transaction}
        syncOperationId={tx.syncOperationId}
        syncPayload={tx.syncPayload}
        firstAttemptAt={tx.firstAttemptAt}
      />
      <AccountDialog
        open={account.open}
        onOpenChange={(open) => setAccount((prev) => ({ ...prev, open }))}
        account={account.account}
      />
      <CategoryDialog
        open={category.open}
        onOpenChange={(open) => setCategory((prev) => ({ ...prev, open }))}
        category={category.category}
        categoryId={category.categoryId}
        defaultGroup={category.group}
      />
    </DialogsContext.Provider>
  );
}
