import { useEffect, useState } from "react";
import { offerStatementImport } from "@/lib/importOffer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createAccount, fetchInstitutions, updateAccount } from "@/lib/data";
import { resolveInstitutionChoice, type InstitutionChoice } from "@/lib/institutionSelection";
import { InstitutionPicker } from "@/components/accounts/InstitutionPicker";
import { getApiErrorMessage } from "@/lib/errors";
import { parseAmount, ACCOUNT_TYPE_LABEL } from "@/lib/format";
import type { Account, AccountInput, AccountType } from "@/types/finnos";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Cash has no institution; its color is fixed. Every other color comes from the institution.
const CASH_COLOR = "#047857";
const DEFAULT_LABEL: Record<AccountType, string> = {
  corrente: "Conta padrão", salario: "Conta padrão", digital: "Conta padrão", poupanca: "Conta padrão",
  carteira: "Dinheiro padrão", beneficio: "Benefício padrão",
};
const DEFAULT_HINT: Record<AccountType, string> = {
  corrente: "Vem marcada primeiro em Pix, débito e no pagamento de faturas.",
  salario: "Vem marcada primeiro em Pix, débito e no pagamento de faturas.",
  digital: "Vem marcada primeiro em Pix, débito e no pagamento de faturas.",
  poupanca: "Vem marcada primeiro em Pix, débito e no pagamento de faturas.",
  carteira: "Vem marcado primeiro nos gastos em dinheiro.",
  beneficio: "Vem marcado primeiro nos gastos com benefício.",
};
const ACCOUNT_TYPES: AccountType[] = ["corrente", "salario", "digital", "poupanca", "carteira", "beneficio"];

interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: Account;
  /** Name to start a new one with (the card name Apple Pay sent). */
  initialName?: string;
}

export function AccountDialog({ open, onOpenChange, account, initialName }: AccountDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [institutionChoice, setInstitutionChoice] = useState<InstitutionChoice>("new");
  const institutionsQuery = useQuery({ queryKey: ["institutions"], queryFn: fetchInstitutions, enabled: open });
  const institutions = institutionsQuery.data ?? [];
  const [type, setType] = useState<AccountType>("corrente");
  const [color, setColor] = useState(CASH_COLOR);
  const [isDefault, setIsDefault] = useState(false);
  const [initialRaw, setInitialRaw] = useState("0");
  const [overdraftRaw, setOverdraftRaw] = useState("");
  const [active, setActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (account) {
      setName(account.name);
      setInstitution(account.institution);
      setInstitutionChoice(account.institution_id ?? (account.institution ? "new" : "none"));
      setType(account.type);
      setColor(account.color);
      setInitialRaw(String(account.initial_balance));
      setOverdraftRaw(account.overdraft_limit ? String(account.overdraft_limit) : "");
      setActive(account.active);
      setIsDefault(Boolean(account.is_default));
    } else {
      setName(initialName ?? "");
      setOverdraftRaw("");
      setInstitution("");
      setInstitutionChoice("new");
      setType("corrente");
      setColor(CASH_COLOR);
      setInitialRaw("0");
      setActive(true);
      setIsDefault(false);
    }
  }, [open, account, initialName]);

  const mutation = useMutation({
    mutationFn: async (input: AccountInput) => {
      // Offline registration is a draft. Do not attempt to create a related
      // financial institution before the primary entity has been synced.
      const resolved = !navigator.onLine && !account
        ? { institution: input.institution, institution_id: institutionChoice === "new" ? null : input.institution_id }
        : input.type === "carteira" ? { institution: "", institution_id: null }
        : await resolveInstitutionChoice(institutionChoice, input.institution, institutions);
      const payload = { ...input, ...resolved };
      return account ? updateAccount(account.id, payload) : createAccount(payload);
    },
    onSuccess: async (saved) => {
      if (account) toast.success("Conta atualizada.");
      else toast.success("Conta criada.", {
        description: "Quer trazer os últimos 90 dias do extrato?",
        duration: 12000,
        action: saved?.id ? { label: "Importar extrato", onClick: () => offerStatementImport(`account:${saved.id}`) } : undefined,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["institutions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["account"] }),
      ]);
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof Error && error.message === "FINNOS_OFFLINE_QUEUED") {
        toast.info("Cadastro de conta salvo neste aparelho", {
          description: "Aguardando sincronização. Ainda não está confirmado no servidor.",
        });
        onOpenChange(false);
        return;
      }
      setFormError(getApiErrorMessage(error));
    },
  });

  const submit = () => {
    setFormError(null);
    const initial = parseAmount(initialRaw);
    if (!name.trim()) return setFormError("Dê um nome à conta.");
    if (type !== "carteira" && institutionChoice === "new" && institution.trim().length < 2 && !account)
      return setFormError(type === "beneficio" ? "Escolha a empresa do benefício." : "Escolha o banco da conta.");
    if (initial === null || !Number.isSafeInteger(Math.round(initial * 100)) || Math.abs(initial * 100 - Math.round(initial * 100)) > 1e-6)
      return setFormError("Informe um saldo inicial válido, com até duas casas decimais.");
    const overdraft = overdraftRaw.trim() ? parseAmount(overdraftRaw) : 0;
    if (overdraft === null || overdraft < 0 || Math.abs(overdraft * 100 - Math.round(overdraft * 100)) > 1e-6)
      return setFormError("Informe um limite de cheque especial válido (ou deixe em branco).");
    mutation.mutate({
      name: name.trim(),
      institution: type === "carteira" ? "" : institution.trim(),
      institution_id: type !== "carteira" && institutionChoice !== "new" && institutionChoice !== "none" && !institutionChoice.startsWith("catalog:") ? institutionChoice : null,
      type,
      color: type === "carteira" ? CASH_COLOR : color,
      initial_balance: initial,
      // 0 removes the limit; only bank accounts have cheque especial.
      overdraft_limit: type === "corrente" || type === "digital" ? overdraft : 0,
      active,
      // Only send the flag when it is turned on or changed, so editing keeps the current default.
      ...(isDefault || account?.is_default ? { is_default: isDefault } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">{account ? "Editar conta" : "Nova conta"}</DialogTitle>
          <DialogDescription>Contas guardam o saldo e o histórico das suas movimentações.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          data-testid="account-form"
        >
          <div className="space-y-2">
            <Label htmlFor="account-name">Nome</Label>
            <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Nubank, Carteira" maxLength={60} data-testid="account-name-input" />
          </div>
          {type !== "carteira" ? (
            <InstitutionPicker institutions={institutions} choice={institutionChoice} name={institution}
              kind={type === "beneficio" ? "beneficio" : "banco"} allowNone={Boolean(account && !account.institution_id)}
              label={type === "beneficio" ? "Empresa do benefício" : "Banco"}
              onChoice={value => { setInstitutionChoice(value); if (value === "none") setInstitution(""); else if (value !== "new" && !value.startsWith("catalog:")) setInstitution(institutions.find(item => item.id === value)?.name ?? ""); }}
              onName={setInstitution} />
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="account-type">Tipo</Label>
              <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
                <SelectTrigger id="account-type" className="w-full" aria-label="Tipo da conta" data-testid="account-type-select">
                  <SelectValue>{ACCOUNT_TYPE_LABEL[type]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {ACCOUNT_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-initial">Saldo inicial (R$)</Label>
              <Input id="account-initial" inputMode="decimal" value={initialRaw} onChange={(e) => setInitialRaw(e.target.value)} data-testid="account-initial-input" />
              <p className="text-xs text-muted-foreground">Use um valor negativo se a conta já estiver no cheque especial (ex.: -500,00).</p>
            </div>
            {type === "corrente" || type === "digital" ? (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="account-overdraft">Limite do cheque especial (R$)</Label>
                <Input id="account-overdraft" inputMode="decimal" placeholder="Sem cheque especial" value={overdraftRaw}
                  onChange={(e) => setOverdraftRaw(e.target.value)} data-testid="account-overdraft-input" />
                <p className="text-xs text-muted-foreground">Com limite, pagar ou transferir sem saldo pede sua confirmação.</p>
              </div>
            ) : null}
          </div>
          <div className="flex items-start gap-3 rounded-2xl bg-muted/50 p-3">
            <Checkbox id="account-default" checked={isDefault} onCheckedChange={(checked) => setIsDefault(checked === true)} data-testid="account-default-checkbox" />
            <Label htmlFor="account-default" className="flex flex-col items-start gap-0.5 font-normal">
              <span className="font-semibold">{DEFAULT_LABEL[type]}</span>
              <span className="text-xs text-muted-foreground">{DEFAULT_HINT[type]}</span>
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <Checkbox id="account-active" checked={active} onCheckedChange={(checked) => setActive(checked === true)} data-testid="account-active-checkbox" />
            <Label htmlFor="account-active" className="font-normal">
              Conta ativa
            </Label>
          </div>
          {formError ? (
            <p role="alert" className="text-sm font-medium text-destructive" data-testid="account-form-error">
              {formError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending} data-testid="account-cancel-button">
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="account-submit-button">
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : account ? "Salvar alterações" : "Criar conta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
