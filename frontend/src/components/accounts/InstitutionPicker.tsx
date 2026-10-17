import type { Institution } from "@/types/finnos";
import type { InstitutionChoice } from "@/lib/institutionSelection";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function InstitutionPicker({
  institutions, choice, name, onChoice, onName, label = "Instituição financeira",
}: {
  institutions: Institution[];
  choice: InstitutionChoice;
  name: string;
  onChoice: (value: InstitutionChoice) => void;
  onName: (value: string) => void;
  label?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="wallet-institution-choice">{label}</Label>
        <Select value={choice} onValueChange={onChoice}>
          <SelectTrigger id="wallet-institution-choice" className="w-full" aria-label={label}>
            <SelectValue placeholder="Escolha a instituição" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">+ Cadastrar instituição</SelectItem>
            <SelectItem value="none">Sem instituição</SelectItem>
            {institutions.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {choice === "new" && (
        <div className="space-y-2">
          <Label htmlFor="wallet-institution-name">Nome da instituição</Label>
          <Input id="wallet-institution-name" value={name} maxLength={60} onChange={e => onName(e.target.value)}
            placeholder="Ex.: Nubank, Banco Inter" />
          <p className="text-xs text-muted-foreground">Nomes diferentes não serão associados automaticamente. O cadastro é exclusivo da sua conta.</p>
        </div>
      )}
    </div>
  );
}
