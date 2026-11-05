import { useState, type ReactNode } from "react";
import { Bell, BrainCircuit, ChevronDown, Copy, KeyRound, Play, ShieldCheck, Smartphone, WalletCards, Zap } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { isLocalMode } from "@/lib/mode";
import { registerLinkBase } from "@/lib/registerLink";
import { AiKeysCard } from "@/components/ai/AiKeysCard";
import { cn } from "@/lib/utils";

type Status = "pronto" | "indisponivel";

/** How to connect FINNOS to the iPhone without an App Store app: Shortcuts open the register filled in. */
export default function SettingsIntegrations() {
  const base = registerLinkBase(window.location.origin);
  const local = isLocalMode();
  // "#sua-ia" (from the FINNOS IA panel) opens straight on connecting an AI.
  const { hash } = useLocation();
  const [open, setOpen] = useState<string | null>(hash === "#sua-ia" ? "sua-ia" : "atalhos");
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); toast.success("Copiado. Cole no app Atalhos."); } catch { toast.error("Não consegui copiar. Selecione e copie o texto."); }
  };
  const code = (value: string) => (
    <span className="mt-1 flex items-center gap-2 rounded-xl bg-muted px-3 py-2">
      <code className="min-w-0 flex-1 break-all text-xs">{value}</code>
      <button type="button" onClick={() => void copy(value)} aria-label="Copiar" className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-background"><Copy className="h-4 w-4" aria-hidden="true" /></button>
    </span>
  );

  const items: Array<{ id: string; name: string; description: string; icon: typeof Zap; status: Status; body: ReactNode }> = [
    {
      id: "atalhos", name: "Apple Atalhos: registro rápido", icon: Zap, status: "pronto",
      description: "Fale ou digite \"café 3,80 e uber 14\" pela Siri ou por um botão na tela de início.",
      body: (
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Abra o app <strong>Atalhos</strong> e toque em <strong>+</strong>.</li>
          <li>Adicione a ação <strong>Pedir Entrada</strong> (tipo Texto, pergunta "Como foi?"). Para falar em vez de digitar, use <strong>Ditar Texto</strong>.</li>
          <li>Adicione <strong>Codificar URL</strong> com a entrada do passo anterior.</li>
          <li>Adicione <strong>Abrir URLs</strong> com este endereço seguido da entrada codificada:{code(`${base}texto=`)}</li>
          <li>Dê o nome <strong>Registrar no FINNOS</strong>. Diga "E aí Siri, Registrar no FINNOS" ou adicione o atalho à tela de início.</li>
          <li>O FINNOS abre em "Entendi", e nada é gravado antes de você confirmar.</li>
        </ol>
      ),
    },
    {
      id: "applepay", name: "Registro por Apple Pay", icon: WalletCards, status: "pronto",
      description: "Cada compra por aproximação com a Carteira abre o FINNOS já preenchido para você confirmar.",
      body: (
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>No app <strong>Atalhos</strong>, vá em <strong>Automação</strong> → <strong>Nova Automação</strong> → <strong>Transação</strong> (iOS 17 ou mais novo).</li>
          <li>Escolha os cartões da Carteira e marque <strong>Executar Imediatamente</strong>.</li>
          <li>Adicione <strong>Codificar URL</strong> para <em>Valor</em>, <em>Comerciante</em> e <em>Cartão ou Passe</em>, que vêm da transação.</li>
          <li>Adicione <strong>Abrir URLs</strong> com este endereço e os três valores no lugar indicado:{code(`${base}valor=[Valor]&nome=[Comerciante]&cartao=[Cartão]`)}</li>
          <li>Ao pagar, o FINNOS abre com a compra em "Entendi". Confira a categoria e registre.</li>
        </ol>
      ),
    },
    {
      id: "notificacoes", name: "Notificações da Carteira", icon: Bell, status: "indisponivel",
      description: "O iPhone não deixa nenhum app ou site ler as notificações de outros apps.",
      body: <p className="text-sm">As compras feitas com a Carteira chegam pelo <strong>Registro por Apple Pay</strong>, acima, que usa a automação oficial do iPhone.</p>,
    },
    {
      id: "sua-ia", name: "Conectar sua IA", icon: KeyRound, status: local ? "indisponivel" : "pronto",
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
    <div><h1 className="font-heading text-2xl font-bold">Integrações e automações</h1><p className="mt-1 text-sm text-muted-foreground">Registre sem abrir o app, pela Siri, por um atalho ou a cada compra com Apple Pay.</p></div>

    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {items.map((item, index) => (
        <section key={item.id} className={index ? "border-t border-border" : ""} data-testid={`integration-${item.id}`}>
          <button type="button" onClick={() => setOpen(open === item.id ? null : item.id)} aria-expanded={open === item.id} className="flex w-full items-start gap-3 p-4 text-left">
            <span className="rounded-xl bg-primary/10 p-2 text-primary"><item.icon className="h-5 w-5" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1"><span className="block font-medium">{item.name}</span><span className="mt-1 block text-xs text-muted-foreground">{item.description}</span></span>
            <span className={cn("shrink-0 rounded-full px-2 py-1 text-xs font-semibold", item.status === "pronto" ? "bg-income/10 text-income" : "bg-muted text-muted-foreground")}>{item.status === "pronto" ? "Disponível" : item.id === "sua-ia" ? "Precisa de conta" : "Indisponível no iPhone"}</span>
            <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", open === item.id && "rotate-180")} aria-hidden="true" />
          </button>
          {open === item.id ? <div className="px-4 pb-4 pl-[3.75rem]">{item.body}</div> : null}
        </section>
      ))}
    </div>

    <div className="space-y-2 rounded-2xl border border-border bg-card p-4 text-sm">
      <p className="flex items-center gap-2 font-medium"><Play className="h-4 w-4 text-primary" aria-hidden="true" />Teste antes de criar o atalho</p>
      <a href={`${base}texto=${encodeURIComponent("café 3,80 e uber 14")}`} className="inline-flex rounded-full border border-border px-3 py-1.5 text-xs font-semibold" data-testid="integration-test-link">Abrir "café 3,80 e uber 14"</a>
    </div>

    <ul className="space-y-2 text-xs text-muted-foreground">
      <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />Os dados vão depois do "#" do endereço: ficam no seu iPhone e não passam pelo servidor. Nada é gravado sem a sua confirmação.</li>
      <li className="flex gap-2"><Smartphone className="h-4 w-4 shrink-0" aria-hidden="true" />No iPhone, os links dos Atalhos abrem no Safari. Mantenha o FINNOS conectado no Safari para o registro abrir direto.</li>
    </ul>
  </main>;
}
