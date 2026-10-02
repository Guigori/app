import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createCard, deleteCard, fetchAccounts, updateCard } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { parseAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CardInput, CreditCard } from "@/types/finnos";
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

const COLORS = ["#5B3FE4", "#8B5CF6", "#0EA5E9", "#10B981", "#F97316", "#EF4444", "#111827"];

interface CardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card?: CreditCard;
}

export function CardDialog({ open, onOpenChange, card }: CardDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [limitRaw, setLimitRaw] = useState("");
  const [closingDay, setClosingDay] = useState("20");
  const [dueDay, setDueDay] = useState("27");
  const [accountId, setAccountId] = useState("none");
  const [active, setActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts, enabled: open, staleTime: 60_000 });
  const accounts = accountsQuery.data ?? [];

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (card) {
      setName(card.name);
      setInstitution(card.institution);
      setColor(card.color);
      setLimitRaw(String(card.limit));
      setClosingDay(String(card.closing_day));
      setDueDay(String(card.due_day));
      setAccountId(card.payment_account_id ?? "none");
      setActive(card.active);
    } else {
      setName("");
      setInstitution("");
      setColor(COLORS[0]);
      setLimitRaw("");
      setClosingDay("20");
      setDueDay("27");
      setAccountId("none");
      setActive(true);
    }
  }, [open, card]);

  const mutation = useMutation({
    mutationFn: (input: CardInput) => (card ? updateCard(card.id, input) : createCard(input)),
    onSuccess: async () => {
      toast.success(card ? "Cartão atualizado." : "Cartão cadastrado.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cards"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
      onOpenChange(false);
    },
    onError: (error) => setFormError(getApiErrorMessage(error)),
  });

  const submit = () => {
    setFormError(null);
    const limit = parseAmount(limitRaw);
    const closing = parseInt(closingDay, 10);
    const due = parseInt(dueDay, 10);
    if (!name.trim()) return setFormError("Dê um nome ao cartão.");
    if (!limit || limit <= 0) return setFormError("Informe o limite do cartão.");
    if (!closing || closing < 1 || closing > 28) return setFormError("O dia de fechamento deve ficar entre 1 e 28.");
    if (!due || due < 1 || due > 28) return setFormError("O dia de vencimento deve ficar entre 1 e 28.");
    mutation.mutate({
      name: name.trim(),
      institution: institution.trim(),
      color,
      limit,
      closing_day: closing,
      due_day: due,
      payment_account_id: accountId === "none" ? null : accountId,
      active,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">{card ? "Editar cartão" : "Novo cartão"}</DialogTitle>
          <DialogDescription>
            O fechamento e o vencimento definem a fatura aberta e o melhor dia de compra.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          data-testid="card-form"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="card-name">Nome</Label>
              <Input
                id="card-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Nubank Ultravioleta"
                maxLength={60}
                data-testid="card-name-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="card-institution">Banco</Label>
              <Input
                id="card-institution"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="Ex.: Nubank"
                maxLength={60}
                data-testid="card-institution-input"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="card-limit">Limite (R$)</Label>
              <Input
                id="card-limit"
                inputMode="decimal"
                value={limitRaw}
                onChange={(e) => setLimitRaw(e.target.value)}
                placeholder="0,00"
                data-testid="card-limit-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="card-closing">Fechamento (dia)</Label>
              <Input
                id="card-closing"
                inputMode="numeric"
                value={closingDay}
                onChange={(e) => setClosingDay(e.target.value)}
                data-testid="card-closing-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="card-due">Vencimento (dia)</Label>
              <Input
                id="card-due"
                inputMode="numeric"
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
                data-testid="card-due-input"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="card-account">Conta de pagamento</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="card-account" className="w-full" aria-label="Conta de pagamento" data-testid="card-account-select">
                <SelectValue>
                  {accountId === "none" ? "Não definida" : (accounts.find((a) => a.id === accountId)?.name ?? "")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Não definida</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Cor do cartão">
              {COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setColor(option)}
                  aria-label={`Usar a cor ${option}`}
                  aria-pressed={color === option}
                  className={cn(
                    "h-8 w-8 rounded-full transition-transform duration-150 hover:scale-110",
                    color === option ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : undefined,
                  )}
                  style={{ backgroundColor: option }}
                  data-testid={`card-color-${option.replace("#", "")}`}
                />
              ))}
            </div>
          </div>

          <label className="flex items-center gap-3 text-sm text-foreground">
            <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} data-testid="card-active-checkbox" />
            Cartão ativo
          </label>

          {formError ? (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert" data-testid="card-form-error">
              {formError}
            </p>
          ) : null}

          <DialogFooter className="gap-2">
            {card ? (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-destructive hover:bg-destructive/10"
                onClick={async () => {
                  try {
                    await deleteCard(card.id);
                    toast.success("Cartão excluído.");
                    await queryClient.invalidateQueries({ queryKey: ["cards"] });
                    onOpenChange(false);
                  } catch (error) {
                    setFormError(getApiErrorMessage(error));
                  }
                }}
                data-testid="card-delete-button"
              >
                Excluir
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="card-cancel-button">
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="card-submit-button">
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {card ? "Salvar" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
