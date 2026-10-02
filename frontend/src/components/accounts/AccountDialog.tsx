import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createAccount, updateAccount } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { parseAmount, ACCOUNT_TYPE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
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

const ACCOUNT_COLORS = ["#070F52", "#8A05BE", "#FF7A00", "#EC7000", "#10B981", "#06B6D4", "#F43F5E", "#64748B"];
const ACCOUNT_TYPES: AccountType[] = ["corrente", "salario", "digital", "poupanca", "carteira"];

interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: Account;
}

export function AccountDialog({ open, onOpenChange, account }: AccountDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [type, setType] = useState<AccountType>("corrente");
  const [color, setColor] = useState(ACCOUNT_COLORS[0]);
  const [initialRaw, setInitialRaw] = useState("0");
  const [active, setActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (account) {
      setName(account.name);
      setInstitution(account.institution);
      setType(account.type);
      setColor(account.color);
      setInitialRaw(String(account.initial_balance));
      setActive(account.active);
    } else {
      setName("");
      setInstitution("");
      setType("corrente");
      setColor(ACCOUNT_COLORS[0]);
      setInitialRaw("0");
      setActive(true);
    }
  }, [open, account]);

  const mutation = useMutation({
    mutationFn: (input: AccountInput) =>
      account ? updateAccount(account.id, input) : createAccount(input),
    onSuccess: async () => {
      toast.success(account ? "Conta atualizada." : "Conta criada.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["account"] }),
      ]);
      onOpenChange(false);
    },
    onError: (error) => setFormError(getApiErrorMessage(error)),
  });

  const submit = () => {
    setFormError(null);
    const initial = parseAmount(initialRaw);
    if (!name.trim()) return setFormError("Dê um nome à conta.");
    if (initial === null || initial < 0) return setFormError("Informe um saldo inicial válido.");
    mutation.mutate({
      name: name.trim(),
      institution: institution.trim(),
      type,
      color,
      initial_balance: initial,
      active,
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
          <div className="space-y-2">
            <Label htmlFor="account-institution">Instituição</Label>
            <Input id="account-institution" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Ex.: Nubank, Banco Inter" maxLength={60} data-testid="account-institution-input" />
          </div>
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
            </div>
          </div>
          <div className="space-y-2">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2">
              {ACCOUNT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Selecionar cor ${c}`}
                  aria-pressed={color === c}
                  className={cn("h-8 w-8 rounded-full border-2 transition-transform", color === c ? "scale-110 border-foreground" : "border-transparent hover:scale-105")}
                  style={{ backgroundColor: c }}
                  data-testid="account-color-swatch"
                />
              ))}
            </div>
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
