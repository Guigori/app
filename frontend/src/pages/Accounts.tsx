import { useState } from "react";
import { getAccountPaymentMethods, setAccountPaymentMethods, clearLocalAccountPaymentMethods, PAYMENT_METHODS, type PaymentMethod } from "@/lib/accountPaymentPreferences";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusCircle, Wallet } from "lucide-react";
import { toast } from "sonner";
import { deleteAccount, fetchAccounts, fetchCards, fetchInstitutions } from "@/lib/data";
import { CardDialog } from "@/components/cards/CardDialog";
import { WalletInstitutions } from "@/components/accounts/WalletInstitutions";
import { InstitutionManagerDialog } from "@/components/accounts/InstitutionManagerDialog";
import { getApiErrorMessage } from "@/lib/errors";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { AccountDetailDialog } from "@/components/accounts/AccountDetailDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Account, CreditCard } from "@/types/finnos";

export default function Accounts() {
  const dialogs = useDialogs();
  const queryClient = useQueryClient();
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const accounts = accountsQuery.data ?? [];
  const cardsQuery = useQuery({ queryKey: ["cards"], queryFn: async () => {
    try { return await fetchCards(); }
    catch (error) {
      if (!navigator.onLine && error instanceof Error && error.message === "FINNOS_OFFLINE_NO_CACHE") return [];
      throw error;
    }
  } });
  const institutionsQuery = useQuery({ queryKey: ["institutions"], queryFn: fetchInstitutions });
  const cards = cardsQuery.data ?? [];
  const institutions = institutionsQuery.data ?? [];
  const [cardDialog, setCardDialog] = useState<{ open: boolean; card?: CreditCard }>({ open: false });
  const [institutionManagerOpen, setInstitutionManagerOpen] = useState(false);

  const [selected, setSelected] = useState<Account | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);
  const [configuring, setConfiguring] = useState<Account | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [savingMethods, setSavingMethods] = useState(false);
  const [loadingMethods, setLoadingMethods] = useState(false);
  const openPaymentMethods = async (account: Account) => {
    setConfiguring(account); setLoadingMethods(true);
    try { setMethods(await getAccountPaymentMethods(account)); } catch (error) { toast.error(getApiErrorMessage(error)); setConfiguring(null); } finally { setLoadingMethods(false); }
  };
  const savePaymentMethods = async () => {
    if (!configuring) return;
    setSavingMethods(true);
    try { await setAccountPaymentMethods(configuring, methods); toast.success("Formas de pagamento atualizadas."); setConfiguring(null); }
    catch (error) { toast.error(getApiErrorMessage(error)); } finally { setSavingMethods(false); }
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAccount(id),
    onSuccess: async (_result, deletedId) => {
      clearLocalAccountPaymentMethods(deletedId);
      toast.success("Conta excluída.");
      setPendingDelete(null);
      setSelected(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["institutions"] }),
      ]);
    },
    onError: (error) => {
      if (error instanceof Error && error.message === "FINNOS_OFFLINE_QUEUED") {
        setPendingDelete(null);
        toast.info("Exclusão da conta aguardando sincronização", {
          description: "A conta continua no servidor até a confirmação. Não tente excluí-la novamente.",
        });
        return;
      }
      toast.error(getApiErrorMessage(error));
    },
  });

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Carteira</h1>
          <p className="mt-1 text-sm text-muted-foreground">Instituições, contas e cartões com saldos e faturas organizados.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => dialogs.openAccount()} data-testid="new-account-button"><PlusCircle className="h-4 w-4"/> Nova conta</Button>
          <Button variant="outline" onClick={() => setCardDialog({ open: true })}><PlusCircle className="h-4 w-4"/> Novo cartão</Button>
          <Button variant="outline" onClick={() => setInstitutionManagerOpen(true)}>Instituições</Button>
        </div>
      </div>

      {(accountsQuery.isPending || cardsQuery.isPending || institutionsQuery.isPending) ? (
        <FinnosPageLoading title="Carregando Carteira" description="Organizando suas instituições, contas e cartões." />
      ) : (accountsQuery.isError || cardsQuery.isError || institutionsQuery.isError) ? (
        <Card role="alert" data-testid="accounts-load-error"><CardContent className="space-y-3 p-5">
          <p>{getApiErrorMessage(accountsQuery.error ?? cardsQuery.error ?? institutionsQuery.error, "Não foi possível carregar sua Carteira.")}</p>
          <Button variant="outline" onClick={() => { void accountsQuery.refetch(); void cardsQuery.refetch(); void institutionsQuery.refetch(); }}>Tentar novamente</Button>
        </CardContent></Card>
      ) : accounts.length === 0 && cards.length === 0 && institutions.length === 0 ? (
        <EmptyState icon={<Wallet className="h-5 w-5"/>} title="Sua Carteira está vazia"
          description="Adicione uma conta bancária ou um cartão para começar."
          action={<Button onClick={() => dialogs.openAccount()} data-testid="accounts-empty-create-button">Criar conta</Button>} />
      ) : (
        <WalletInstitutions accounts={accounts} cards={cards} institutions={institutions}
          onOpenAccount={setSelected} onEditAccount={account => dialogs.openAccount(account)}
          onDeleteAccount={setPendingDelete} onPaymentMethods={account => { void openPaymentMethods(account); }}
          onEditCard={card => setCardDialog({ open: true, card })}/>
      )}
      <CardDialog open={cardDialog.open} card={cardDialog.card} onOpenChange={open => setCardDialog(prev => ({ ...prev, open }))} />
      <InstitutionManagerDialog open={institutionManagerOpen} onOpenChange={setInstitutionManagerOpen} institutions={institutions} />
      {configuring && <div role="dialog" aria-modal="true" aria-label="Formas de pagamento" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-md space-y-4 rounded-3xl bg-background p-6 text-foreground shadow-xl"><h2 className="text-xl font-semibold">Formas de pagamento · {configuring.name}</h2><p className="text-sm text-muted-foreground">Escolha as formas disponíveis para esta conta. Cartões de crédito são administrados separadamente.</p>{loadingMethods ? <p>Carregando...</p> : PAYMENT_METHODS.map(method => <label key={method} className="flex items-center gap-3 rounded-xl border p-3"><input type="checkbox" checked={methods.includes(method)} onChange={e => setMethods(current => e.target.checked ? [...current,method] : current.filter(x => x !== method))}/>{method}</label>)}<p className="text-xs text-muted-foreground">As configurações da conta autenticada são armazenadas no Firebase. No modo local, permanecem neste dispositivo.</p><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setConfiguring(null)}>Cancelar</Button><Button disabled={savingMethods || loadingMethods} onClick={() => void savePaymentMethods()}>{savingMethods ? "Salvando..." : "Salvar"}</Button></div></div></div>}
      <AccountDetailDialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        account={selected}
        onEdit={(account) => {
          setSelected(null);
          dialogs.openAccount(account);
        }}
        onDelete={(account) => setPendingDelete(account)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Excluir conta?"
        description={
          pendingDelete
            ? `A conta "${pendingDelete.name}" será removida. Contas com transações vinculadas não podem ser excluídas.`
            : ""
        }
        confirmLabel="Excluir"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}
