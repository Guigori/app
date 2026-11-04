import { useState } from "react";
import { Calculator, Check, WandSparkles } from "lucide-react";
import { getRegisterDefault, setRegisterDefault, type RegisterDefault } from "@/lib/registerPreferences";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const OPTIONS: Array<{ value: RegisterDefault; label: string; description: string; icon: typeof Calculator }> = [
  { value: "manual", label: "Registro rápido", description: "Valor no teclado, conta, categoria e salvar", icon: Calculator },
  { value: "inteligente", label: "Registro inteligente", description: "Escrever, falar ou fotografar o recibo", icon: WandSparkles },
];

/** Configurações → Novo registro: what the "+" opens first. */
export function RegisterDefaultCard() {
  const [value, setValue] = useState(getRegisterDefault);
  return (
    <Card data-testid="settings-register-card">
      <CardHeader>
        <CardTitle className="font-heading">Ao tocar no +</CardTitle>
        <CardDescription>Escolha a tela que abre primeiro. A outra continua a um toque.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2" role="radiogroup" aria-label="Tela inicial do novo registro">
        {OPTIONS.map((option) => (
          <button key={option.value} type="button" role="radio" aria-checked={value === option.value}
            onClick={() => { setValue(option.value); setRegisterDefault(option.value); }}
            className={cn("flex items-center gap-3 rounded-2xl border p-4 text-left transition-colors", value === option.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}
            data-testid={`register-default-${option.value}`}>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><option.icon className="h-5 w-5" /></span>
            <span className="flex-1"><span className="block font-medium">{option.label}</span><span className="block text-xs text-muted-foreground">{option.description}</span></span>
            {value === option.value ? <Check className="h-5 w-5 text-primary" /> : null}
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
