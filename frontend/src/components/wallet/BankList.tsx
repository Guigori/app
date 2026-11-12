import { useState } from "react";
import { Link } from "react-router-dom";
import { Banknote, Search } from "lucide-react";
import { bankRows, type BankSort } from "@/lib/walletSummary";
import { formatBRL, formatHiddenBRL } from "@/lib/format";
import type { Account, CreditCard, Institution } from "@/types/finnos";
import { cn } from "@/lib/utils";

const SORTS: { key: BankSort; label: string }[] = [{ key: "saldo", label: "Maior saldo" }, { key: "az", label: "A–Z" }, { key: "cartao", label: "Com cartão" }];

/** Prototype "Bancos e contas": one row per bank. From 5 banks on it gets the search, the
 * sorting and the banks with nothing in them collapsed (prototype "Com 8 bancos"). */
export function BankList({ accounts, cards, institutions, investments, methods, hidden, onOpenCash, onManageInstitutions }: {
  accounts: Account[];
  cards: CreditCard[];
  institutions: Institution[];
  investments: { account?: string | null; current: number }[];
  methods: Record<string, string[]>;
  hidden: boolean;
  onOpenCash: (account: Account) => void;
  onManageInstitutions: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<BankSort>("saldo");
  const [showEmpty, setShowEmpty] = useState(false);
  const money = (cents: number) => (hidden ? formatHiddenBRL() : formatBRL(cents / 100));
  const all = bankRows(accounts, cards, institutions, { investments, methods });
  const many = all.length > 4;
  const rows = bankRows(accounts, cards, institutions, { investments, methods, query, sort: many ? sort : "saldo" });
  const visible = many && !query && !showEmpty ? rows.filter((r) => !r.empty) : rows;
  const emptyCount = all.filter((r) => r.empty).length;
  const cash = accounts.filter((a) => a.type === "carteira" && a.active);
  const available = all.reduce((s, r) => s + (r.accountsCents ?? 0), 0) + cash.reduce((s, a) => s + Math.round(a.balance * 100), 0);
  const max = Math.max(1, ...all.map((r) => r.accountsCents ?? 0));

  return (
    <section aria-label="Bancos e contas" data-testid="wallet-institutions">
      <div className="mx-1 mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-heading text-lg font-bold">Bancos e contas</h2>
        <span className="text-[13px] text-muted-foreground"><span className="tabular-nums">{money(available)}</span> disponível</span>
      </div>
      {many ? (
        <>
          <label className="flex h-12 items-center gap-2.5 rounded-full border border-border bg-card px-4">
            <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar banco, conta ou cartão" aria-label="Buscar"
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground" data-testid="wallet-bank-search" />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted-foreground">Ordenar</span>
            {SORTS.map((o) => (
              <button key={o.key} type="button" onClick={() => setSort(o.key)} aria-pressed={sort === o.key}
                className={cn("h-9 rounded-full px-3 text-xs font-semibold", sort === o.key ? "border-2 border-primary bg-primary/10 text-primary" : "border border-border bg-card")}
                data-testid={`wallet-bank-sort-${o.key}`}>{o.label}</button>
            ))}
          </div>
        </>
      ) : null}
      <div className={cn("overflow-hidden rounded-3xl border border-border bg-card", many && "mt-3")}>
        {visible.map((r, i) => (
          <Link key={r.key} to={`/contas/banco/${encodeURIComponent(r.key)}`} className={cn("flex items-center gap-3 px-4 py-3.5 hover:bg-muted/40", i > 0 && "border-t border-border/60")}
            data-testid={`wallet-bank-${r.key}`}>
            <span className="grid size-11 shrink-0 place-items-center rounded-[15px] font-heading text-sm font-bold text-white" style={{ background: r.color }} aria-hidden="true">{r.initials}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <strong className="truncate text-[15px]">{r.name}</strong>
                  {r.isDefault ? <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">Padrão</span> : null}
                </span>
                {r.accountsCents === null
                  ? <span className="shrink-0 text-[13px] text-muted-foreground">sem conta</span>
                  : <strong className={cn("shrink-0 text-[15px] tabular-nums", r.accountsCents < 0 && "text-expense")}>{money(r.accountsCents)}</strong>}
              </span>
              {many ? (
                <span className="mt-1.5 flex items-center gap-2">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-primary/10"><span className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.round(((r.accountsCents ?? 0) / max) * 100))}%`, background: r.color }} /></span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{r.products}</span>
                </span>
              ) : (
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {r.products}{r.investedCents ? <> <span className="tabular-nums">{money(r.investedCents)}</span></> : null}
                </span>
              )}
            </span>
          </Link>
        ))}
        {query && visible.length === 0 ? <p className="px-4 py-5 text-center text-sm text-muted-foreground">Nada com esse nome.</p> : null}
        {many && emptyCount > 0 && !query ? (
          <button type="button" onClick={() => setShowEmpty(!showEmpty)} className="flex w-full items-center justify-between border-t border-border/60 px-4 py-3.5 text-sm font-semibold"
            data-testid="wallet-show-empty-banks">
            <span>{showEmpty ? "Recolher bancos sem saldo" : `Mostrar ${emptyCount} ${emptyCount === 1 ? "banco sem saldo" : "bancos sem saldo"}`}</span>
            <span className="text-muted-foreground">{showEmpty ? "−" : "+"}</span>
          </button>
        ) : null}
        {!query ? cash.map((a) => (
          <button key={a.id} type="button" onClick={() => onOpenCash(a)} className={cn("flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/40", (visible.length || emptyCount) && "border-t border-border/60")}
            data-testid={`wallet-account-${a.id}`}>
            <span className="grid size-11 shrink-0 place-items-center rounded-[15px] bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"><Banknote className="size-5" aria-hidden="true" /></span>
            <span className="flex min-w-0 flex-1 justify-between gap-2"><strong className="truncate text-[15px]">{a.name || "Dinheiro"}</strong><strong className="shrink-0 text-[15px] tabular-nums">{money(Math.round(a.balance * 100))}</strong></span>
          </button>
        )) : null}
        {all.length === 0 && cash.length === 0 ? <p className="px-4 py-5 text-center text-sm text-muted-foreground">Nenhum banco cadastrado ainda.</p> : null}
      </div>
      {many ? <p className="mx-1 mt-2.5 text-xs text-muted-foreground">Bancos sem saldo nem fatura ficam recolhidos para a lista não crescer demais.</p> : null}
      <button type="button" onClick={onManageInstitutions} className="mx-1 mt-2.5 text-[13px] font-semibold text-primary">Instituições</button>
    </section>
  );
}
