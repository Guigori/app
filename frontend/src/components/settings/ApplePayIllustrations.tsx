import { useEffect, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, CreditCard, Landmark, ReceiptText, Smartphone, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Small animated drawings for the Apple Pay guide. They are illustrations made for FINNOS, not
 * captures of the iPhone: Apple's screens change between iOS versions, so each step can show a real
 * capture instead (see StepPicture) and falls back to these.
 */

const SCENES = [
  { title: "Você paga", text: "Encosta o iPhone na maquininha, como sempre.", icon: CreditCard },
  { title: "O Atalho avisa", text: "Sozinho, sem abrir app nenhum, manda a compra para o FINNOS.", icon: Zap },
  { title: "Fica pendente", text: "A compra espera no Início, fora do seu saldo.", icon: ReceiptText },
  { title: "Você registra", text: "Um toque em Registrar. Ou Excluir, se não for sua.", icon: Check },
] as const;

function SceneArt({ index, run }: { index: number; run: boolean }) {
  const loop = (delay = 0) => ({ repeat: Infinity, duration: 1.8, delay, ease: "easeOut" as const, repeatDelay: 0.2 });
  if (index === 0) {
    return (
      <svg viewBox="0 0 120 80" className="h-20 w-full" aria-hidden="true">
        <rect x="14" y="14" width="38" height="58" rx="8" className="fill-card stroke-foreground/40" strokeWidth="2" />
        <rect x="68" y="30" width="38" height="34" rx="5" className="fill-muted stroke-foreground/30" strokeWidth="2" />
        {[0, 0.5, 1].map((d) => (
          <motion.path key={d} d="M58 43 q8 -6 0 -14" fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-primary"
            initial={{ opacity: run ? 0 : 1 }} animate={run ? { opacity: [0, 1, 0] } : { opacity: 1 }} transition={run ? loop(d * 0.3) : undefined} />
        ))}
      </svg>
    );
  }
  if (index === 1) {
    return (
      <svg viewBox="0 0 120 80" className="h-20 w-full" aria-hidden="true">
        <rect x="8" y="22" width="26" height="42" rx="6" className="fill-card stroke-foreground/40" strokeWidth="2" />
        <path d="M40 43 H80" className="stroke-foreground/25" strokeWidth="2" strokeDasharray="4 4" />
        <path d="M96 56 a12 12 0 1 1 4 -23 a14 14 0 0 1 -4 23 z" className="fill-primary/15 stroke-primary" strokeWidth="2" />
        <motion.circle cy="43" r="4" className="fill-primary" initial={{ cx: run ? 40 : 80 }} animate={run ? { cx: [40, 80], opacity: [1, 1, 0] } : { cx: 80 }} transition={run ? loop() : undefined} />
      </svg>
    );
  }
  if (index === 2) {
    return (
      <div className="relative mx-auto h-20 w-28">
        <motion.div className="absolute inset-x-0 top-2 rounded-xl border border-border bg-card p-2 shadow-sm"
          initial={{ y: run ? 14 : 0, opacity: run ? 0 : 1 }} animate={run ? { y: [14, 0, 0], opacity: [0, 1, 1] } : { y: 0, opacity: 1 }} transition={run ? loop() : undefined}>
          <div className="flex items-center justify-between text-[10px] font-semibold"><span>Mercado</span><span className="text-expense">R$ 4,99</span></div>
          <span className="mt-1 inline-block rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:text-amber-400">pendente</span>
        </motion.div>
      </div>
    );
  }
  return (
    <div className="relative mx-auto flex h-20 w-28 items-center justify-center">
      <motion.span className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground"
        initial={{ scale: 1 }} animate={run ? { scale: [1, 0.88, 1.08, 1] } : { scale: 1 }} transition={run ? loop() : undefined}>
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: run ? 0 : 1 }} animate={run ? { pathLength: [0, 0, 1] } : { pathLength: 1 }} transition={run ? loop() : undefined} />
        </svg>
      </motion.span>
    </div>
  );
}

/** The whole flow in four scenes, lit one after the other. Still (all four visible) for people who prefer less motion. */
export function ApplePayFlow() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => setActive((i) => (i + 1) % SCENES.length), 2600);
    return () => window.clearInterval(timer);
  }, [reduced]);

  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Como funciona" data-testid="applepay-flow">
      {SCENES.map((scene, i) => {
        const on = reduced || active === i;
        return (
          <li key={scene.title} className={cn("rounded-2xl border bg-card p-3 text-center transition-all duration-500", on ? "border-primary/40 opacity-100" : "border-border opacity-50")}>
            <SceneArt key={`${i}-${on ? active : "still"}`} index={i} run={!reduced && on} />
            <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold"><span className="grid size-5 place-items-center rounded-full bg-primary/10 text-xs text-primary">{i + 1}</span>{scene.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{scene.text}</p>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A real capture of the step when one exists at /atalhos/passos/passo-N.png (drop the files in
 * public/atalhos/passos), otherwise the drawing. The capture hides itself if the file is missing.
 */
export function StepPicture({ n, alt, children }: { n: number; alt: string; children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="mt-2">
      <img src={`/atalhos/passos/passo-${n}.png`} alt={alt} loading="lazy" onLoad={() => setLoaded(true)} onError={() => setLoaded(false)}
        className={cn("mx-auto max-h-80 rounded-2xl border border-border", loaded ? "block" : "hidden")} data-testid={`step-picture-${n}`} />
      {loaded ? null : children}
    </div>
  );
}

function Phone({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="img" aria-label={label} className="mx-auto w-full max-w-[17rem] rounded-[1.6rem] border-2 border-foreground/20 bg-background p-2.5 shadow-sm">
      <div className="mx-auto mb-2 h-1.5 w-14 rounded-full bg-foreground/15" aria-hidden="true" />
      <div className="space-y-1.5 text-[11px]">{children}</div>
    </div>
  );
}

/** Pulses the thing the person has to tap. */
function Tap({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div className={cn("rounded-lg ring-2 ring-primary/70", className)} animate={reduced ? undefined : { boxShadow: ["0 0 0 0 rgba(79,70,229,0.45)", "0 0 0 7px rgba(79,70,229,0)"] }} transition={reduced ? undefined : { repeat: Infinity, duration: 1.5 }}>
      {children}
    </motion.div>
  );
}

const row = "flex items-center justify-between rounded-lg bg-muted px-2.5 py-1.5";

export function MockAutomationTab() {
  return (
    <Phone label="App Atalhos: aba Automação, botão mais e a opção Transação">
      <div className="flex items-center justify-between px-1"><span className="font-semibold">Automação</span><Tap className="grid size-6 place-items-center bg-primary text-primary-foreground">+</Tap></div>
      <div className={row}><span>Hora do Dia</span></div>
      <Tap><div className={cn(row, "bg-background")}><span className="font-semibold">Transação <span className="font-normal text-muted-foreground">(Carteira)</span></span></div></Tap>
      <div className={row}><span>Chegada</span></div>
    </Phone>
  );
}

export function MockTrigger() {
  const reduced = useReducedMotion();
  return (
    <Phone label="Escolher o cartão da Carteira e marcar Executar Imediatamente">
      <div className={row}><span className="flex items-center gap-1.5"><CreditCard className="size-3.5" aria-hidden="true" />Seu cartão</span><Check className="size-3.5 text-primary" aria-hidden="true" /></div>
      <Tap>
        <div className={cn(row, "bg-background")}>
          <span>Executar Imediatamente</span>
          <span className="relative h-4 w-7 rounded-full bg-muted-foreground/30" aria-hidden="true">
            <motion.span className="absolute top-0.5 size-3 rounded-full bg-primary" initial={{ left: 2 }} animate={reduced ? { left: 14 } : { left: [2, 14, 14, 2] }} transition={reduced ? undefined : { repeat: Infinity, duration: 3 }} />
          </span>
        </div>
      </Tap>
      <div className="rounded-lg bg-primary px-2.5 py-1.5 text-center font-semibold text-primary-foreground">Nova Automação em Branco</div>
    </Phone>
  );
}

export function MockUrlAction({ url }: { url: string }) {
  return (
    <Phone label="Ação Obter Conteúdo do URL com o endereço e o método POST">
      <div className="rounded-lg border border-border p-2">
        <p className="font-semibold">Obter Conteúdo do URL</p>
        <Tap className="mt-1.5"><p className={cn(row, "break-all bg-background font-mono text-[10px]")}>{url}</p></Tap>
        <p className={cn(row, "mt-1")}><span>Método</span><span className="font-semibold text-primary">POST</span></p>
      </div>
    </Phone>
  );
}

export function MockBody({ header }: { header: string }) {
  return (
    <Phone label="Cabeçalho Authorization e corpo JSON com valor, descricao e carteira">
      <div className="rounded-lg border border-border p-2">
        <p className="font-semibold">Cabeçalhos</p>
        <p className={cn(row, "mt-1 gap-2 font-mono text-[10px]")}><span>Authorization</span><span className="truncate text-primary">{header}</span></p>
        <p className="mt-2 font-semibold">Corpo da Solicitação · JSON</p>
        {[["valor", "Valor"], ["descricao", "Comerciante"], ["carteira", "Cartão ou Passe"]].map(([k, v]) => (
          <p key={k} className={cn(row, "mt-1 font-mono text-[10px]")}><span>{k}</span><span className="rounded-full bg-primary/15 px-1.5 text-primary">{v}</span></p>
        ))}
      </div>
    </Phone>
  );
}

export function MockNotification() {
  const reduced = useReducedMotion();
  return (
    <Phone label="Notificação do Atalhos confirmando a compra pendente">
      <motion.div className="rounded-xl bg-card p-2.5 shadow ring-1 ring-foreground/10" initial={{ y: reduced ? 0 : -10, opacity: reduced ? 1 : 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5 }}>
        <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><Smartphone className="size-3" aria-hidden="true" />ATALHOS · agora</p>
        <p className="mt-0.5 font-semibold">FINNOS</p>
        <p>Pendente no FINNOS: Mercado · R$ 4,99 · Cartão Nubank Roxinho</p>
      </motion.div>
    </Phone>
  );
}

export function WalletIcon({ kind }: { kind: "cartao" | "conta" }) {
  const Icon = kind === "conta" ? Landmark : CreditCard;
  return <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />;
}
