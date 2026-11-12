import { useEffect, useState } from "react";
import { offerStatementImport } from "@/lib/importOffer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createCard, deleteCard, fetchInstitutions, updateCard } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { parseAmount } from "@/lib/format";
import { resolveInstitutionChoice, type InstitutionChoice } from "@/lib/institutionSelection";
import { InstitutionPicker } from "@/components/accounts/InstitutionPicker";
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

// The color comes from the card's bank; this is only the fallback before linking.
const FALLBACK_COLOR = "#5B3FE4";

interface CardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card?: CreditCard;
  /** Name to start a new one with (the card name Apple Pay sent). */
  initialName?: string;
}

export function CardDialog({ open, onOpenChange, card, initialName }: CardDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [institutionChoice, setInstitutionChoice] = useState<InstitutionChoice>("new");
  const [color, setColor] = useState(FALLBACK_COLOR);
  const [isDefault, setIsDefault] = useState(false);
  const [limitRaw, setLimitRaw] = useState("");
  const [closingDay, setClosingDay] = useState("20");
  const [dueDay, setDueDay] = useState("27");
  const [accountId, setAccountId] = useState("none");
  const [active, setActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const institutionsQuery = useQuery({ queryKey: ["institutions"], queryFn: fetchInstitutions, enabled: open });
  const institutions = institutionsQuery.data ?? [];

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (card) {
      setName(card.name);
      setInstitution(card.institution);
      setInstitutionChoice(card.institution_id ?? (card.institution ? "new" : "none"));
      setColor(card.color);
      setLimitRaw(String(card.limit));
      setClosingDay(String(card.closing_day));
      setDueDay(String(card.due_day));
      setAccountId(card.payment_account_id ?? "none");
      setActive(card.active);
      setIsDefault(Boolean(card.is_default));
    } else {
      setName(initialName ?? "");
      setInstitution("");
      setInstitutionChoice("new");
      setColor(FALLBACK_COLOR);
      setIsDefault(false);
      setLimitRaw("");
      setClosingDay("20");
      setDueDay("27");
      setAccountId("none");
      setActive(true);
    }
  }, [open, card, initialName]);

  const mutation = useMutation({
    mutationFn: async (input: CardInput) => {
      // Offline registration is a draft. Do not attempt to create a related
      // financial institution before the primary entity has been synced.
      const resolved = !navigator.onLine && !card
        ? { institution: input.institution, institution_id: institutionChoice === "new" ? null : input.institution_id }
        : await resolveInstitutionChoice(institutionChoice, input.institution, institutions);
      const payload = { ...input, ...resolved };
      return card ? updateCard(card.id, payload) : createCard(payload);
    },
    onSuccess: async (saved) => {
      if (card) toast.success("Cartão atualizado.");
      else toast.success("Cartão cadastrado.", {
        description: "Quer trazer as faturas dos últimos 90 dias?",
        duration: 12000,
        action: saved?.id ? { label: "Importar fatura", onClick: () => offerStatementImport(`card:${saved.id}`) } : undefined,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cards"] }),
        queryClient.invalidateQueries({ queryKey: ["institutions"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof Error && error.message === "FINNOS_OFFLINE_QUEUED") {
        toast.info("Cadastro de cartão salvo neste aparelho", {
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
    const limit = parseAmount(limitRaw);
    const closing = parseInt(closingDay, 10);
    const due = parseInt(dueDay, 10);
    if (!name.trim()) return setFormError("Dê um nome ao cartão.");
    if (institutionChoice === "new" && institution.trim().length < 2 && !card) return setFormError("Escolha o banco do cartão.");
    if (!limit || limit <= 0) return setFormError("Informe o limite do cartão.");
    if (!closing || closing < 1 || closing > 31) return setFormError("O dia de fechamento deve ficar entre 1 e 31.");
    if (!due || due < 1 || due > 31) return setFormError("O dia de vencimento deve ficar entre 1 e 31.");
    mutation.mutate({
      name: name.trim(),
      institution: institution.trim(),
      institution_id: institutionChoice !== "new" && institutionChoice !== "none" && !institutionChoice.startsWith("catalog:") ? institutionChoice : null,
      color,
      limit,
      closing_day: closing,
      due_day: due,
      payment_account_id: accountId === "none" ? null : accountId,
      active,
      // Only send the flag when it is turned on or changed, so editing keeps the current default.
      ...(isDefault || card?.is_default ? { is_default: isDefault } : {}),
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
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="card-name">Nome do cartão</Label>
              <Input
                id="card-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Roxinho, Cartão da casa"
                maxLength={60}
                data-testid="card-name-input"
              />
            </div>
            <InstitutionPicker institutions={institutions} choice={institutionChoice} name={institution}
              allowNone={Boolean(card && !card.institution_id)}
              onChoice={value => { setInstitutionChoice(value); if (value === "none") setInstitution(""); else if (value !== "new" && !value.startsWith("catalog:")) setInstitution(institutions.find(item => item.id === value)?.name ?? ""); }}
              onName={setInstitution} label="Banco do cartão" />
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

          <p className="text-xs text-muted-foreground" data-testid="card-pay-note">
            A conta que paga a fatura é escolhida na hora de pagar.
          </p>

          <div className="flex items-start gap-3 rounded-2xl bg-muted/50 p-3">
            <Checkbox id="card-default" checked={isDefault} onCheckedChange={(v) => setIsDefault(v === true)} data-testid="card-default-checkbox" />
            <Label htmlFor="card-default" className="flex flex-col items-start gap-0.5 font-normal">
              <span className="font-semibold">Cartão padrão</span>
              <span className="text-xs text-muted-foreground">Vem marcado primeiro quando o gasto é no crédito.</span>
            </Label>
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
                    if (error instanceof Error && error.message === "FINNOS_OFFLINE_QUEUED") {
                      toast.info("Exclusão do cartão aguardando sincronização", {
                        description: "O cartão permanecerá visível até a confirmação do servidor.",
                      });
                      onOpenChange(false);
                      return;
                    }
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
