import { useState, type ReactNode } from "react";
import { Bell, BrainCircuit, ChevronDown, KeyRound, ShieldCheck, WalletCards } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { isLocalMode } from "@/lib/mode";
import { AiKeysCard } from "@/components/ai/AiKeysCard";
import { ApplePaySetup } from "@/components/settings/ApplePaySetup";
import { cn } from "@/lib/utils";

type Status = "pronto" | "indisponivel" | "conta";

/** Apple Pay purchases straight into FINNOS, and connecting an AI. Other Shortcuts flows are off for now. */
export default function SettingsIntegrations() {
  const local = isLocalMode();
  // "#sua-ia" (from the FINNOS IA panel) opens straight on connecting an AI.
  const { hash } = useLocation();
  const fromHash = ({ "#sua-ia": "sua-ia", "#apple-pay": "applepay-pendente", "#sem-abrir": "applepay-pendente" } as Record<string, string>)[hash];
  const [open, setOpen] = useState<string | null>(fromHash ?? (local ? null : "applepay-pendente"));
  const needsAccount = <p className="text-sm">No modo local não há servidor para o atalho falar. <Link to="/cadastro" className="font-semibold text-primary">Crie sua conta preservando seus dados</Link> para usar.</p>;

  const items: Array<{ id: string; name: string; description: string; icon: typeof WalletCards; status: Status; body: ReactNode }> = [
    {
      id: "applepay-pendente", name: "Apple Pay", icon: WalletCards, status: local ? "conta" : "pronto",
      description: "Cada compra com a Carteira chega ao FINNOS sem abrir o app e espera você revisar no Início.",
      body: local ? needsAccount : <ApplePaySetup />,
    },
    {
      id: "sua-ia", name: "Conectar sua IA", icon: KeyRound, status: local ? "conta" : "pronto",
      description: "Use sua chave do ChatGPT, Claude ou Gemini para a FINNOS IA responder qualquer pergunta, com seus dados como contexto.",
      body: local
        ? <p className="text-sm">No modo local a chave não tem onde ficar guardada com segurança. <Link to="/cadastro" className="font-semibold text-primary">Crie sua conta preservando seus dados</Link> para conectar sua IA.</p>
        : <AiKeysCard />,
    },
    {
      id: "ia", name: "FINNOS IA", icon: BrainCircuit, status: "pronto",
      description: "Pergunte sobre seus gastos, metas e orçamento, ou peça para registrar e organizar.",
      body: <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("finnos-ai-open"))} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Abrir a FINNOS IA</button>,
    },
  ];

  return <main className="mx-auto max-w-2xl space-y-5 pb-28 text-foreground animate-fade-up" data-testid="settings-integrations">
    <div><h1 className="font-heading text-2xl font-bold">Integrações e automações</h1><p className="mt-1 text-sm text-muted-foreground">Compras do Apple Pay direto no FINNOS e a sua IA conectada.</p></div>

    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {items.map((item, index) => (
        <section key={item.id} className={index ? "border-t border-border" : ""} data-testid={`integration-${item.id}`}>
          <button type="button" onClick={() => setOpen(open === item.id ? null : item.id)} aria-expanded={open === item.id} className="flex w-full items-start gap-3 p-4 text-left">
            <span className="rounded-xl bg-primary/10 p-2 text-primary"><item.icon className="h-5 w-5" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1"><span className="block font-medium">{item.name}</span><span className="mt-1 block text-xs text-muted-foreground">{item.description}</span></span>
            <span className={cn("shrink-0 rounded-full px-2 py-1 text-xs font-semibold", item.status === "pronto" ? "bg-income/10 text-income" : "bg-muted text-muted-foreground")}>{item.status === "pronto" ? "Disponível" : item.status === "conta" ? "Precisa de conta" : "Indisponível no iPhone"}</span>
            <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", open === item.id && "rotate-180")} aria-hidden="true" />
          </button>
          {open === item.id ? <div className="px-4 pb-4 sm:pl-[3.75rem]">{item.body}</div> : null}
        </section>
      ))}
    </div>

    <ul className="space-y-2 text-xs text-muted-foreground">
      <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />O código do iPhone só cria compras para revisar e lista nomes de contas, cartões e categorias. Cada uso aparece na tela do Apple Pay, e você desconecta quando quiser.</li>
      <li className="flex gap-2"><Bell className="h-4 w-4 shrink-0" aria-hidden="true" />O iPhone não deixa nenhum app ou site ler as notificações da Carteira. As compras chegam pela automação Transação do app Atalhos.</li>
    </ul>
  </main>;
}
