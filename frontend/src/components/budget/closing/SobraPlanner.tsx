/**
 * Fechar o mês · para onde vai a sobra. A pessoa divide a sobra em quantos destinos quiser — outra conta, uma meta
 * (a reserva de emergência é uma meta), um investimento — e registra cada um no módulo de origem antes de fechar:
 * a transferência no registro novo, o aporte em Metas, a aplicação em Investimentos. O Orçamento só guarda a lista
 * (com o que já foi registrado) no retrato do mês.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRightLeft, Check, LineChart, Plus, Target, X } from "lucide-react";
import { toast } from "sonner";
import { fetchMe, fetchTransactions } from "@/lib/data";
import { currentMonth, todayISO } from "@/lib/format";
import { openRegisterSheet } from "@/lib/registerSheet";
import { listInvestments, saveInvestment, type Investment } from "@/lib/investments";
import type { FinnosGoal } from "@/lib/goals";
import type { BudgetClosing } from "@/lib/budget/server";
import { GoalMoneySheet } from "@/components/patrimonio/GoalMoneySheet";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { Account, Transaction } from "@/types/finnos";

export type Alloc = BudgetClosing["allocation"][number];
type Kind = Alloc["kind"];

const KIND: Record<Kind, { label: string; icon: typeof Target; verb: string }> = {
  conta: { label: "Outra conta", icon: ArrowRightLeft, verb: "Transferir" },
  meta: { label: "Meta", icon: Target, verb: "Guardar" },
  investimento: { label: "Investimento", icon: LineChart, verb: "Aplicar" },
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const parseBR = (v: string) => Number(v.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) || 0;
const fmtInput = (v: number) => (v ? v.toFixed(2).replace(".", ",") : "");

/** The list survives leaving the page (to Metas, the register…) until the month is closed. */
export function useSobraAllocs(month: string) {
  const key = `finnos:closing-sobra:${month}`;
  const [allocs, setAllocs] = useState<Alloc[]>(() => { try { return JSON.parse(sessionStorage.getItem(key) || "[]") as Alloc[]; } catch { return []; } });
  useEffect(() => { try { setAllocs(JSON.parse(sessionStorage.getItem(key) || "[]") as Alloc[]); } catch { setAllocs([]); } }, [key]);
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(allocs)); } catch { /* storage blocked */ } }, [key, allocs]);
  const clear = () => { try { sessionStorage.removeItem(key); } catch { /* ignore */ } };
  return [allocs, setAllocs, clear] as const;
}

/** The transfer the register is opened with: from the main account to the chosen one, named after the month. */
function transferTemplate(a: Alloc, from: Account, monthName: string): Transaction {
  return {
    id: "", version: 1, recurrence_id: null, name: `Sobra de ${monthName} · ${a.name}`, value: a.value, type: "transferencia", status: "pago", date: todayISO(),
    account_id: from.id, account_name: from.name, card_id: null, card_name: null, to_account_id: a.target_id ?? null, to_account_name: a.name,
    category_id: null, category_name: null, category_color: null, category_icon: null, fixed: false, recurrence: null, installment: false,
    total_installments: null, current_installment: null, installment_value: null, adjusted_value: null, attachment: null, notes: null,
    notify_enabled: false, created_at: new Date().toISOString(),
  } as unknown as Transaction;
}

export function SobraPlanner({ sobra, monthName, accounts, goals, mainAccount, money, allocs, setAllocs, locked }: {
  sobra: number; monthName: string; accounts: Account[]; goals: FinnosGoal[]; mainAccount: Account | undefined;
  money: (n: number) => string; allocs: Alloc[]; setAllocs: (f: (cur: Alloc[]) => Alloc[]) => void; locked?: boolean;
}) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const investments = useQuery({ queryKey: ["investments", me.data?.id], queryFn: () => listInvestments(me.data!.id), enabled: Boolean(me.data?.id) });
  // Transfers are saved by the register: they are found here by their name and value once the Fluxo has them.
  const nowTx = useQuery({ queryKey: ["transactions", { month: currentMonth() }], queryFn: () => fetchTransactions({ month: currentMonth() }) });
  const [goalFor, setGoalFor] = useState<Alloc | null>(null);
  const [investFor, setInvestFor] = useState<Alloc | null>(null);

  const used = r2(allocs.reduce((s, a) => s + a.value, 0));
  const rest = r2(sobra - used);
  const others = accounts.filter((a) => a.active !== false && a.type !== "beneficio" && a.id !== mainAccount?.id);
  const patch = (id: string, p: Partial<Alloc>) => setAllocs((cur) => cur.map((a) => (a.id === id ? { ...a, ...p } : a)));

  useEffect(() => {
    if (!mainAccount) return;
    const found = (a: Alloc) => (nowTx.data ?? []).some((t) => t.type === "transferencia" && t.name === transferTemplate(a, mainAccount, monthName).name && Math.abs(t.value - a.value) < 0.01);
    if (allocs.some((a) => a.kind === "conta" && !a.done && found(a))) setAllocs((cur) => cur.map((a) => (a.kind === "conta" && !a.done && found(a) ? { ...a, done: true } : a)));
  }, [nowTx.data, allocs, mainAccount, monthName, setAllocs]);

  const add = (kind: Kind) => setAllocs((cur) => [...cur, { id: `${kind}:${Date.now()}`, kind, name: KIND[kind].label, value: Math.max(0, r2(sobra - cur.reduce((s, a) => s + a.value, 0))), target_id: null, done: false }]);
  const register = (a: Alloc) => {
    if (!a.target_id || !(a.value > 0)) { toast.error("Escolha o destino e o valor."); return; }
    if (a.kind === "conta") { if (mainAccount) openRegisterSheet({ template: transferTemplate(a, mainAccount, monthName) }); }
    else if (a.kind === "meta") setGoalFor(a);
    else setInvestFor(a);
  };
  const targets = (a: Alloc): { id: string; name: string }[] => a.kind === "conta" ? others.map((x) => ({ id: x.id, name: x.name }))
    : a.kind === "meta" ? goals.map((g) => ({ id: g.id, name: g.name })) : (investments.data ?? []).map((i) => ({ id: i.id, name: i.name }));
  const goal = goalFor ? goals.find((g) => g.id === goalFor.target_id) ?? null : null;

  if (sobra <= 0) return <p className="text-[13px] text-muted-foreground">{monthName.charAt(0).toUpperCase() + monthName.slice(1)} fechou sem sobra: nada para distribuir.</p>;
  return (
    <div data-testid="closing-sobra">
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-primary/[0.06] px-4 py-3">
        <span className="text-[13px] text-muted-foreground">Sobrou<strong className="block font-heading text-2xl text-foreground tabular-nums">{money(sobra)}</strong></span>
        <span className="text-right text-[13px] text-muted-foreground">Fica em {mainAccount?.name ?? "na conta"}<strong className={cn("block font-heading text-lg tabular-nums", rest < 0 ? "text-expense" : "text-foreground")}>{money(Math.max(0, rest))}</strong></span>
      </div>
      {sobra > 0 ? <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">{allocs.map((a, i) => <span key={a.id} style={{ width: `${Math.min(100, (a.value / sobra) * 100)}%`, background: ["#4B2CFF", "#8058FF", "#10B981", "#F59E0B", "#0EA5E9"][i % 5] }} />)}</div> : null}
      {rest < 0 ? <p className="mt-2 text-xs font-semibold text-expense">Os destinos passam da sobra em {money(-rest)}.</p> : null}

      <ul className="mt-3 flex flex-col gap-2">
        {allocs.map((a) => {
          const K = KIND[a.kind];
          return (
            <li key={a.id} className={cn("rounded-2xl border p-3", a.done ? "border-income/40 bg-income/[0.05]" : "border-border")} data-testid="sobra-row">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><K.icon className="h-4 w-4" /></span>
                <select aria-label={`Destino (${K.label})`} disabled={a.done || locked} value={a.target_id ?? ""} onChange={(e) => { const t = targets(a).find((x) => x.id === e.target.value); patch(a.id, { target_id: t?.id ?? null, name: t?.name ?? K.label }); }}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-2.5 text-sm font-medium">
                  <option value="">{a.kind === "conta" ? "Para qual conta?" : a.kind === "meta" ? "Qual meta?" : "Qual investimento?"}</option>
                  {targets(a).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {!a.done && !locked ? <button type="button" onClick={() => setAllocs((cur) => cur.filter((x) => x.id !== a.id))} aria-label="Tirar este destino" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button> : null}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <label className="flex h-10 min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-input bg-background px-3 text-sm"><span className="text-muted-foreground">R$</span>
                  <input inputMode="decimal" disabled={a.done || locked} aria-label="Valor" defaultValue={fmtInput(a.value)} key={`${a.id}:${a.done}`} onBlur={(e) => patch(a.id, { value: r2(Math.max(0, parseBR(e.target.value))) })} className="w-0 min-w-0 flex-1 bg-transparent font-semibold tabular-nums outline-none" />
                </label>
                {a.done ? <span className="inline-flex h-10 w-[6.5rem] shrink-0 items-center justify-center gap-1.5 rounded-full bg-income/15 text-xs font-bold text-income"><Check className="h-4 w-4" /> Registrado</span>
                  : <button type="button" onClick={() => register(a)} disabled={locked} className="h-10 w-[6.5rem] shrink-0 rounded-full bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-50" data-testid="sobra-register">{K.verb}</button>}
              </div>
              {a.kind === "conta" && !a.done && a.target_id ? <button type="button" onClick={() => patch(a.id, { done: true })} className="mt-1.5 text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline">Já fiz essa transferência</button> : null}
              {a.kind === "meta" && !goals.length ? <Link to="/metas" className="mt-1.5 inline-block text-xs font-semibold text-primary">Criar uma meta (a reserva de emergência também é uma meta)</Link> : null}
              {a.kind === "investimento" && investments.data && !investments.data.length ? <Link to="/investimentos" className="mt-1.5 inline-block text-xs font-semibold text-primary">Cadastrar um investimento</Link> : null}
            </li>
          );
        })}
      </ul>

      {!locked ? (
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {(Object.keys(KIND) as Kind[]).map((k) => { const K = KIND[k]; return <button key={k} type="button" onClick={() => add(k)} className="flex h-11 min-w-0 items-center justify-center gap-1 rounded-full border border-border px-1 text-[12px] font-bold hover:bg-muted" data-testid={`sobra-add-${k}`}><Plus className="h-3.5 w-3.5" />{K.label}</button>; })}
        </div>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">Cada destino é registrado no lugar dele: a transferência no registro, o aporte em Metas e a aplicação em Investimentos. Registre todos antes de fechar o mês.</p>

      {goal && goalFor && me.data ? (
        <GoalMoneySheet key={goalFor.id} goal={goal} goals={goals} accounts={accounts} userId={me.data.id} mode="aporte" open onOpenChange={(o) => { if (!o) setGoalFor(null); }}
          initialAmount={goalFor.value} initialAccountId={mainAccount?.id} display={money}
          onDone={() => { patch(goalFor.id, { done: true }); setGoalFor(null); void qc.invalidateQueries({ queryKey: ["goals"] }); }} />
      ) : null}
      {investFor && me.data ? (
        <InvestSheet alloc={investFor} position={(investments.data ?? []).find((i) => i.id === investFor.target_id) ?? null} money={money} from={mainAccount}
          onClose={() => setInvestFor(null)}
          onConfirm={async (p) => {
            await saveInvestment(me.data!.id, { name: p.name, kind: p.kind, invested: r2(p.invested + investFor.value), current: r2(p.current + investFor.value), updated_on: todayISO(), account: p.account, notes: p.notes }, p.id);
            await qc.invalidateQueries({ queryKey: ["investments"] });
            patch(investFor.id, { done: true }); setInvestFor(null); toast.success(`${money(investFor.value)} aplicados em ${p.name}.`);
          }} />
      ) : null}
    </div>
  );
}

/** Confirmação da aplicação: o valor entra na posição em Investimentos (aplicado e valor atual). */
function InvestSheet({ alloc, position, money, from, onClose, onConfirm }: { alloc: Alloc; position: Investment | null; money: (n: number) => string; from: Account | undefined; onClose: () => void; onConfirm: (p: Investment) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const side = useMemo(() => (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches ? "right" : "bottom"), []);
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side={side} className={cn("gap-0 p-5", side === "bottom" && "rounded-t-3xl")} data-testid="sobra-invest-sheet">
        <SheetTitle className="font-heading text-lg">Aplicar em {position?.name ?? "investimento"}</SheetTitle>
        <SheetDescription className="mt-1 text-[13px]">O valor entra na posição em Investimentos, no aplicado e no valor atual.</SheetDescription>
        {position ? (
          <dl className="mt-4 divide-y divide-border rounded-2xl border border-border text-sm">
            <div className="flex justify-between px-4 py-3"><dt className="text-muted-foreground">Valor</dt><dd className="font-semibold tabular-nums">{money(alloc.value)}</dd></div>
            <div className="flex justify-between px-4 py-3"><dt className="text-muted-foreground">Aplicado depois</dt><dd className="tabular-nums">{money(position.invested + alloc.value)}</dd></div>
            <div className="flex justify-between px-4 py-3"><dt className="text-muted-foreground">Sai de</dt><dd>{from?.name ?? "—"}</dd></div>
          </dl>
        ) : <p className="mt-4 text-sm text-muted-foreground">Escolha o investimento antes.</p>}
        <p className="mt-3 text-xs text-muted-foreground">O saldo da conta muda quando a saída do dinheiro for registrada no Fluxo (transferência ou extrato da corretora).</p>
        <button type="button" disabled={!position || busy} onClick={async () => { if (!position) return; setBusy(true); try { await onConfirm(position); } catch { toast.error("Não deu para registrar a aplicação. Tente de novo."); } finally { setBusy(false); } }}
          className="mt-5 h-12 w-full rounded-full bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50" data-testid="sobra-invest-confirm">{busy ? "Registrando…" : `Confirmar ${money(alloc.value)}`}</button>
      </SheetContent>
    </Sheet>
  );
}
