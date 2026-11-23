/** Public landing page for the closed beta: what FINNOS is, what it does and a form to ask for an invite. */
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock, Check, CreditCard, Loader2, Radar, ShieldCheck, Smartphone, Sparkles, Wallet } from "lucide-react";
import { FinnosIcon, FinnosLogo } from "@/components/brand/FinnosLogo";
import { joinWaitlist } from "@/lib/beta";
import { getApiErrorMessage } from "@/lib/errors";

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function maskPhone(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** The hero shows the one number FINNOS is built around, with clearly fictional data. */
function HeroPhone() {
  const week = [62, 40, 88, 55, 30, 0, 0];
  const days = ["S", "T", "Q", "Q", "S", "S", "D"];
  return (
    <div className="relative mx-auto w-full max-w-[22rem]" aria-label="Exemplo da tela de orçamento com dados fictícios">
      <div className="rounded-[2.2rem] border border-white/15 bg-white p-5 text-navy shadow-[0_40px_80px_-30px_rgba(2,6,25,.8)]">
        <div className="flex items-center justify-between text-[13px] text-slate-500">
          <span>Orçamento de novembro</span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">No ritmo</span>
        </div>
        <p className="mt-4 text-sm text-slate-500">Livre para gastar hoje</p>
        <p className="font-heading text-[2.6rem] font-bold leading-none tracking-tight">{BRL(84.2)}</p>
        <p className="mt-2 text-[13px] text-slate-500">Já contando aluguel, cartão e a parcela do celular.</p>
        <div className="mt-5 flex h-20 items-end gap-2" aria-hidden="true">
          {week.map((v, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <div className={`w-full rounded-md ${i === 4 ? "bg-primary" : v ? "bg-[#DCD6FF]" : "border border-dashed border-[#DCD6FF]"}`} style={{ height: `${Math.max(v, 12) * 0.62}px` }} />
              <span className="text-[10px] text-slate-400">{days[i]}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 space-y-2.5 border-t border-slate-100 pt-4 text-[13px]">
          <div className="flex justify-between"><span className="text-slate-500">Fatura Nubank · dia 28</span><span className="font-semibold">{BRL(1240.9)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Salário · dia 30</span><span className="font-semibold text-emerald-600">+{BRL(5200)}</span></div>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-white/55">Valores de exemplo</p>
    </div>
  );
}

interface Feature { icon: typeof Wallet; title: string; text: string }
const FEATURES: Feature[] = [
  { icon: CalendarClock, title: "Fluxo", text: "O que entra e o que sai nos próximos dias, com o saldo de cada conta na data. Contas a pagar avisam antes de vencer." },
  { icon: CreditCard, title: "Carteira e cartões", text: "Contas, cartões, faturas abertas e fechadas, parcelas que ainda faltam e saldo de VR e VA em um lugar só." },
  { icon: Sparkles, title: "Análises e FIINT", text: "Para onde foi o dinheiro, quanto cada categoria pesa e dicas que olham o seu mês, não uma média genérica." },
  { icon: Radar, title: "Radar", text: "Avisa quando um gasto foge do padrão, uma assinatura sobe de preço ou o saldo vai ficar curto." },
  { icon: Smartphone, title: "Registro em segundos", text: "Escreva \"almoço 32 no débito\" ou deixe o Atalho do iPhone mandar a compra do Apple Pay para você só confirmar." },
];

function Section({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`mx-auto w-full max-w-5xl px-6 ${className}`}>{children}</section>;
}

function RequestForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!consent) { setError("Marque a caixa para podermos entrar em contato."); return; }
    setState("sending");
    try {
      await joinWaitlist({ name: name.trim(), phone, email: email.trim(), consent, website, source: new URLSearchParams(window.location.search).get("origem") ?? undefined });
      setState("done");
    } catch (err) {
      setState("idle");
      setError(getApiErrorMessage(err, "Não deu para enviar agora. Confira sua internet e tente de novo."));
    }
  };

  if (state === "done") {
    return (
      <div role="status" className="rounded-[1.75rem] bg-white p-7 text-navy" data-testid="waitlist-done">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-600"><Check className="h-6 w-6" /></span>
        <p className="mt-4 font-heading text-2xl font-bold">Pedido recebido{name.trim() ? `, ${name.trim().split(/\s+/)[0]}` : ""}.</p>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-600">Quando seu acesso for liberado, você recebe um e-mail em <strong className="text-navy">{email.trim()}</strong> com o passo a passo. Use esse mesmo e-mail para entrar.</p>
      </div>
    );
  }

  const field = "h-12 w-full rounded-2xl border border-[#DCD6FF] bg-white px-4 text-[15px] text-navy placeholder:text-slate-400 outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15";
  return (
    <form onSubmit={submit} className="rounded-[1.75rem] bg-white p-6 text-navy sm:p-7" data-testid="waitlist-form" noValidate={false}>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Nome</span>
          <input className={field} required minLength={2} maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Como você se chama" data-testid="waitlist-name" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Telefone com DDD</span>
          <input className={field} required inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} placeholder="(11) 98888-7777" data-testid="waitlist-phone" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">E-mail</span>
          <input className={field} required type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" data-testid="waitlist-email" />
          <span className="mt-1.5 block text-xs text-slate-500">É com ele que você vai entrar no FINNOS.</span>
        </label>
        {/* Hidden from people; bots fill it in and are ignored. */}
        <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" className="absolute left-[-9999px] h-0 w-0 opacity-0" />
        <label className="flex items-start gap-3 text-[13px] leading-snug text-slate-600">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#4B2CFF]" data-testid="waitlist-consent" />
          <span>Aceito que o FINNOS guarde esses dados para me mandar o convite e falar comigo sobre o beta. Não compartilhamos com ninguém.</span>
        </label>
        {error ? <p role="alert" className="text-sm font-medium text-rose-600" data-testid="waitlist-error">{error}</p> : null}
        <button type="submit" disabled={state === "sending"} className="flex h-13 w-full items-center justify-center rounded-2xl bg-primary py-3.5 font-semibold text-white transition hover:bg-[#3A1FE0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:opacity-70" data-testid="waitlist-submit">
          {state === "sending" ? <Loader2 className="h-5 w-5 animate-spin" aria-label="Enviando" /> : "Pedir meu convite"}
        </button>
      </div>
    </form>
  );
}

export default function Welcome() {
  const [params] = useSearchParams();
  const pending = params.get("acesso") === "pendente";
  return (
    <div className="min-h-svh bg-[#F6F5FF] font-sans text-navy">
      <div className="relative overflow-hidden bg-[linear-gradient(180deg,#020619_0%,var(--finnos-app,#070F52)_55%,#2A17B8_100%)] text-white">
        <FinnosIcon className="pointer-events-none absolute -right-40 top-24 h-[34rem] w-[34rem] rotate-[-14deg] opacity-[.12] lg:-right-20" />
        <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
          <FinnosLogo variant="dark" className="w-32" />
          <Link to="/login" className="rounded-full border border-white/25 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10" data-testid="welcome-login">Já tenho convite</Link>
        </header>
        {pending ? (
          <div role="status" className="relative mx-auto mt-6 max-w-5xl px-6" data-testid="welcome-pending">
            <p className="rounded-2xl bg-white/10 px-4 py-3 text-sm leading-relaxed text-white/90 ring-1 ring-white/20">Seu e-mail ainda não foi liberado no beta. Se já pediu o convite, é só aguardar o e-mail. Se não, peça abaixo.</p>
          </div>
        ) : null}
        <Section className="relative grid items-center gap-12 pb-20 pt-12 lg:grid-cols-[1.1fr_.9fr] lg:pb-28 lg:pt-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[13px] text-white/80 ring-1 ring-white/15">Beta fechado, por convite</p>
            <h1 className="mt-5 font-heading text-[clamp(2.4rem,9vw,4.1rem)] font-bold leading-[1.02] tracking-tight">Saiba quanto dá para gastar hoje sem apertar o fim do mês.</h1>
            <p className="mt-5 max-w-xl text-[clamp(1rem,4.2vw,1.2rem)] leading-relaxed text-white/75">O FINNOS junta contas, cartões, faturas e contas a pagar e transforma tudo em um número diário. Você gasta com tranquilidade e vê antes o que vai pesar.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#convite" className="rounded-2xl bg-white px-6 py-3.5 font-semibold text-navy transition hover:bg-[#EDEAFF]" data-testid="welcome-cta">Pedir convite</a>
              <a href="#funcoes" className="rounded-2xl px-5 py-3.5 font-semibold text-white/85 ring-1 ring-white/25 transition hover:bg-white/10">Ver o que ele faz</a>
            </div>
          </div>
          <HeroPhone />
        </Section>
      </div>

      <Section className="py-20">
        <div id="funcoes" className="grid gap-10 lg:grid-cols-[.8fr_1.2fr]">
          <div>
            <h2 className="font-heading text-[clamp(1.8rem,6vw,2.6rem)] font-bold leading-tight tracking-tight">Um orçamento que acompanha o seu dia, não uma planilha para preencher no fim do mês.</h2>
            <p className="mt-4 text-[17px] leading-relaxed text-slate-600">Você define quanto quer gastar por categoria. O FINNOS desconta o que já está comprometido e mostra o que sobra para hoje, para a semana e para o mês. No fim do mês, ajuda a fechar, decidir o que fazer com a sobra e começar o próximo.</p>
          </div>
          <ul className="divide-y divide-[#E2DEFF] rounded-[1.75rem] bg-white px-6">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4 py-5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#EFECFF] text-primary"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                <div>
                  <h3 className="font-heading text-[17px] font-semibold">{title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <div className="bg-navy text-white">
        <Section className="grid gap-12 py-20 lg:grid-cols-2">
          <div>
            <h2 className="font-heading text-[clamp(1.8rem,6vw,2.6rem)] font-bold leading-tight tracking-tight">Como entrar no beta</h2>
            <ol className="mt-8 space-y-6">
              {[
                ["Peça o convite", "Deixe nome, telefone e o e-mail que vai usar para entrar."],
                ["Receba a liberação", "Estamos abrindo para um grupo pequeno. Quando chegar a sua vez, mandamos um e-mail."],
                ["Entre com o mesmo e-mail", "Pelo Google ou criando uma senha. No iPhone, dá para adicionar à Tela de Início e usar como app."],
              ].map(([title, text], i) => (
                <li key={title} className="flex gap-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 font-heading text-sm font-bold ring-1 ring-white/20">{i + 1}</span>
                  <div><p className="font-semibold">{title}</p><p className="mt-1 text-[15px] leading-relaxed text-white/70">{text}</p></div>
                </li>
              ))}
            </ol>
            <p className="mt-10 flex gap-3 text-sm leading-relaxed text-white/65"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-white/80" aria-hidden="true" />O FINNOS não pede senha de banco e não se conecta à sua conta bancária. Você registra o que quer, e seus dados ficam na sua conta.</p>
          </div>
          <div id="convite" className="scroll-mt-6">
            <RequestForm />
          </div>
        </Section>
      </div>

      <footer className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-sm text-slate-500">
        <span>FINNOS · beta</span>
        <Link to="/login" className="font-semibold text-primary hover:underline">Entrar</Link>
      </footer>
    </div>
  );
}
