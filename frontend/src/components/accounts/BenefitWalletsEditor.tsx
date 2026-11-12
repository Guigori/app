import { Plus, Trash2 } from "lucide-react";
import { MAX_WALLETS } from "@/lib/benefits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** One row of the editor; amounts are kept as typed and parsed on save. */
export interface WalletDraft {
  id?: string | null;
  name: string;
  monthlyRaw: string;
  dayRaw: string;
  initialRaw: string;
  allow_negative: boolean;
  is_default: boolean;
}

export const emptyWallet = (index: number): WalletDraft => ({
  name: index === 0 ? "Refeição" : "", monthlyRaw: "", dayRaw: "1", initialRaw: "0", allow_negative: false, is_default: index === 0,
});

/** Cartão de benefício: up to 8 benefits, each with its own value, recharge day and balance. */
export function BenefitWalletsEditor({ wallets, onChange }: { wallets: WalletDraft[]; onChange: (next: WalletDraft[]) => void }) {
  const set = (index: number, patch: Partial<WalletDraft>) =>
    onChange(wallets.map((w, i) => (i === index ? { ...w, ...patch } : patch.is_default ? { ...w, is_default: false } : w)));
  return (
    <fieldset className="space-y-3" data-testid="benefit-wallets">
      <legend className="text-sm font-semibold">Benefícios deste cartão</legend>
      <p className="text-xs text-muted-foreground">
        Cada benefício tem saldo próprio. O que sobra acumula para o mês seguinte e não vence. O padrão vem marcado
        primeiro no registro; você pode trocar na hora.
      </p>
      {wallets.map((wallet, index) => (
        <div key={wallet.id ?? `new-${index}`} className="space-y-2 rounded-2xl border p-3" data-testid={`benefit-wallet-${index}`}>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor={`wallet-name-${index}`}>Nome</Label>
              <Input id={`wallet-name-${index}`} value={wallet.name} maxLength={40} placeholder="Ex.: Mercado"
                onChange={(e) => set(index, { name: e.target.value })} data-testid={`wallet-name-${index}`} />
            </div>
            {wallets.length > 1 ? (
              <Button type="button" variant="ghost" size="icon" aria-label={`Remover ${wallet.name || "benefício"}`}
                onClick={() => {
                  const next = wallets.filter((_, i) => i !== index);
                  if (wallet.is_default && next.length) next[0] = { ...next[0], is_default: true };
                  onChange(next);
                }}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor={`wallet-monthly-${index}`}>Valor por mês</Label>
              <Input id={`wallet-monthly-${index}`} inputMode="decimal" placeholder="0,00" value={wallet.monthlyRaw}
                onChange={(e) => set(index, { monthlyRaw: e.target.value })} data-testid={`wallet-monthly-${index}`} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`wallet-day-${index}`}>Dia da recarga</Label>
              <Input id={`wallet-day-${index}`} inputMode="numeric" value={wallet.dayRaw}
                onChange={(e) => set(index, { dayRaw: e.target.value.replace(/\D/g, "").slice(0, 2) })} data-testid={`wallet-day-${index}`} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`wallet-initial-${index}`}>Saldo hoje</Label>
              <Input id={`wallet-initial-${index}`} inputMode="decimal" value={wallet.initialRaw}
                onChange={(e) => set(index, { initialRaw: e.target.value })} data-testid={`wallet-initial-${index}`} />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="wallet-default" checked={wallet.is_default} onChange={() => set(index, { is_default: true })}
                data-testid={`wallet-default-${index}`} />
              Padrão
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={wallet.allow_negative} onCheckedChange={(c) => set(index, { allow_negative: c === true })} />
              Pode ficar negativo
            </label>
          </div>
        </div>
      ))}
      {wallets.length < MAX_WALLETS ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...wallets, emptyWallet(wallets.length)])}
          data-testid="wallet-add">
          <Plus className="h-4 w-4" aria-hidden="true" /> Adicionar benefício ({wallets.length}/{MAX_WALLETS})
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Limite de {MAX_WALLETS} benefícios por cartão.</p>
      )}
    </fieldset>
  );
}
