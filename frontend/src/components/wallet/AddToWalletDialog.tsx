import { useEffect, useState } from "react";
import { Banknote, CreditCard, Gift, Landmark } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { parseAmount } from "@/lib/format";

export type AddKind = "banco" | "cartao" | "beneficio" | "dinheiro";

const OPTIONS: { kind: AddKind; label: string; hint: string; icon: typeof Landmark; color: string }[] = [
  { kind: "banco", label: "Banco", hint: "Conta, Pix, débito", icon: Landmark, color: "#4B2CFF" },
  { kind: "cartao", label: "Cartão", hint: "Crédito, com fatura", icon: CreditCard, color: "#820AD1" },
  { kind: "beneficio", label: "Benefício", hint: "VR, VA, multi", icon: Gift, color: "#00A86B" },
  { kind: "dinheiro", label: "Dinheiro", hint: "Em espécie", icon: Banknote, color: "#047857" },
];

/** The one "+" of the Carteira (prototype sheet). Dinheiro asks the amount right here. */
export function AddToWalletDialog({ open, onOpenChange, onPick, onSaveCash, cashNow, startOnCash }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (kind: Exclude<AddKind, "dinheiro">) => void;
  onSaveCash: (value: number) => Promise<void>;
  cashNow: number | null;
  /** Open straight on "Quanto você tem em espécie?". */
  startOnCash?: boolean;
}) {
  const [step, setStep] = useState<"menu" | "cash">("menu");
  const [raw, setRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setStep(startOnCash ? "cash" : "menu"); setError(null); setRaw(cashNow != null ? String(cashNow).replace(".", ",") : ""); } }, [open, cashNow, startOnCash]);
  const save = async () => {
    const value = parseAmount(raw || "0");
    if (value === null || value < 0) return setError("Informe um valor válido.");
    setSaving(true);
    try { await onSaveCash(value); onOpenChange(false); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar."); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[30px] sm:max-w-md" data-testid="wallet-add-sheet">
        {step === "menu" ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-heading text-xl">O que você quer adicionar?</DialogTitle>
              <DialogDescription className="sr-only">Banco, cartão, benefício ou dinheiro.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2.5">
              {OPTIONS.map(({ kind, label, hint, icon: Icon, color }) => (
                <button key={kind} type="button" data-testid={`wallet-add-${kind}`}
                  onClick={() => { if (kind === "dinheiro") setStep("cash"); else { onOpenChange(false); onPick(kind); } }}
                  className="flex flex-col gap-2.5 rounded-[22px] bg-primary/[0.07] p-4 text-left transition-colors hover:bg-primary/[0.12]">
                  <span className="grid size-10 place-items-center rounded-[13px] text-white" style={{ background: color }}><Icon className="size-5" aria-hidden="true" /></span>
                  <span><strong className="block text-[15px]">{label}</strong><span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span></span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-heading text-xl">Quanto você tem em espécie?</DialogTitle>
              <DialogDescription>Gastos em dinheiro saem daqui. Dá para ajustar quando quiser.</DialogDescription>
            </DialogHeader>
            <input value={raw} onChange={(e) => setRaw(e.target.value)} inputMode="decimal" aria-label="Valor em espécie" placeholder="R$ 0,00" autoFocus
              className="h-16 w-full rounded-[18px] border border-border bg-background text-center font-heading text-[28px] font-bold outline-none focus:border-primary" data-testid="wallet-cash-input" />
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="h-[50px] w-[110px] rounded-full" onClick={() => setStep("menu")}>Voltar</Button>
              <Button type="button" className="h-[50px] flex-1 rounded-full" disabled={saving} onClick={() => void save()} data-testid="wallet-cash-save">Salvar dinheiro</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
