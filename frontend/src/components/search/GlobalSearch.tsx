import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, ChevronLeft, Clock, CreditCard as CardIcon, LayoutList, MessageCircleMore, Repeat, Search, Tags, Target, Wallet, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { fetchAccounts, fetchCards, fetchCategories, fetchMe, fetchSubscriptions, fetchTransactions } from "@/lib/data";
import { listGoals } from "@/lib/goals";
import { formatBRL, formatDate, formatHiddenBRL } from "@/lib/format";
import { useBalanceHidden } from "@/lib/balance";
import { useNavigationPreferences } from "@/lib/navigationPreferences";
import type { Transaction } from "@/types/finnos";
import { cn } from "@/lib/utils";

type SectionId = "lancamentos" | "contas" | "categorias" | "assinaturas" | "metas" | "telas";
const SECTIONS: { id: SectionId; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: "lancamentos", label: "Lançamentos", icon: ArrowLeftRight },
  { id: "contas", label: "Contas e cartões", icon: Wallet },
  { id: "categorias", label: "Categorias", icon: Tags },
  { id: "assinaturas", label: "Assinaturas", icon: Repeat },
  { id: "metas", label: "Metas", icon: Target },
  { id: "telas", label: "Telas e ajustes", icon: LayoutList },
];

/** Screens and settings, with the words people use to look for them. */
const SCREENS: { name: string; where: string; to: string; words?: string }[] = [
  { name: "Início", where: "Tela", to: "/" },
  { name: "Fluxo", where: "Tela", to: "/transacoes", words: "lancamentos extrato calendario caixa" },
  { name: "Carteira", where: "Tela", to: "/contas", words: "contas cartoes bancos saldo fatura" },
  { name: "Orçamento", where: "Tela", to: "/orcamento", words: "limites planejamento" },
  { name: "Configurar orçamento", where: "Orçamento", to: "/orcamento/configuracoes", words: "limites modelo" },
  { name: "Radar", where: "Tela", to: "/radar", words: "alertas sinais" },
  { name: "Patrimônio", where: "Tela", to: "/patrimonio", words: "metas investimentos reserva" },
  { name: "Análise", where: "Tela", to: "/analise", words: "graficos gastos relatorio" },
  { name: "Assinaturas", where: "Tela", to: "/assinaturas", words: "recorrentes streaming" },
  { name: "Categorias", where: "Configurações", to: "/categorias" },
  { name: "Meu perfil", where: "Perfil", to: "/perfil", words: "nome email foto conta sair segurança privacidade" },
  { name: "Tema claro ou escuro", where: "Configurações › Aparência", to: "/configuracoes/aparencia", words: "modo escuro claro dark aparencia" },
  { name: "Barra e menu", where: "Configurações › Navegação", to: "/configuracoes/navegacao", words: "abas personalizar navegacao" },
  { name: "Tela de Início", where: "Configurações › Painel", to: "/configuracoes/painel", words: "widgets blocos painel" },
  { name: "Botão +", where: "Configurações › Novo registro", to: "/configuracoes/registro", words: "registrar despesa receita" },
  { name: "Gráficos", where: "Configurações", to: "/configuracoes/graficos" },
  { name: "Notificações", where: "Configurações", to: "/configuracoes/notificacoes", words: "avisos lembretes vencimentos" },
  { name: "Dados e backup", where: "Configurações", to: "/configuracoes/dados", words: "exportar importar restaurar planilha" },
  { name: "Integrações e automações", where: "Configurações", to: "/configuracoes/integracoes", words: "apple pay atalhos chave conversa" },
  { name: "Ajuda e suporte", where: "Configurações", to: "/configuracoes/suporte", words: "duvidas feedback" },
  { name: "Sobre o FINNOS", where: "Configurações", to: "/configuracoes/versao", words: "versao" },
];

const RECENT_KEY = "finnos:recent-searches";
const norm = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function readRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 5) : []; } catch { return []; }
}
function rememberSearch(term: string) {
  const t = term.trim();
  if (t.length < 2) return;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([t, ...readRecent().filter((x) => norm(x) !== norm(t))].slice(0, 5))); } catch { /* storage unavailable */ }
}

interface Result { key: string; name: string; sub: string; value?: string; tone?: "in" | "out"; go: () => void }

/**
 * One search for everything: lançamentos, contas e cartões, categorias, assinaturas, metas and the
 * app's own screens and settings, grouped by section. Opens from the header and the menu, and with
 * Ctrl/⌘+K on the computer.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [section, setSection] = useState<"tudo" | SectionId>("tudo");
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const dialogs = useDialogs();
  const { hidden } = useBalanceHidden();
  const prefs = useNavigationPreferences();
  const money = (v: number) => (hidden ? formatHiddenBRL() : formatBRL(v));

  useEffect(() => {
    const show = () => { setOpen(true); setRecent(readRecent()); };
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); show(); }
    };
    window.addEventListener("finnos-search-open", show);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("finnos-search-open", show); window.removeEventListener("keydown", onKey); };
  }, []);
  useEffect(() => { const id = window.setTimeout(() => setDebounced(q.trim()), 220); return () => window.clearTimeout(id); }, [q]);
  useEffect(() => { setSection("tudo"); }, [debounced]);

  const term = norm(debounced);
  const active = open && term.length >= 2;
  const opts = { enabled: open, staleTime: 60_000 } as const;
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts, ...opts });
  const cards = useQuery({ queryKey: ["cards"], queryFn: fetchCards, ...opts });
  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, ...opts });
  const subscriptions = useQuery({ queryKey: ["subscriptions"], queryFn: fetchSubscriptions, ...opts });
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, ...opts });
  const goals = useQuery({ queryKey: ["goals", me.data?.id], queryFn: () => listGoals(me.data!.id), enabled: open && Boolean(me.data), staleTime: 60_000 });
  const transactions = useQuery({ queryKey: ["global-search", term], queryFn: () => fetchTransactions({ search: debounced }), enabled: active, staleTime: 30_000 });

  const close = () => { setOpen(false); setQ(""); setDebounced(""); };
  const pick = (go: () => void) => () => { rememberSearch(q); close(); go(); };
  const has = (...texts: (string | null | undefined)[]) => texts.some((t) => t && norm(t).includes(term));

  const groups = useMemo(() => {
    if (!active) return [] as { id: SectionId; rows: Result[] }[];
    const txs: Transaction[] = [...(transactions.data ?? [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
    const rows: Record<SectionId, Result[]> = {
      lancamentos: txs.map((tx) => ({
        key: tx.id, name: tx.name,
        sub: [tx.category_name ?? (tx.type === "transferencia" ? "Transferência" : "Sem categoria"), formatDate(tx.date), tx.card_name ?? tx.account_name].filter(Boolean).join(" · "),
        value: (tx.type === "receita" ? "+ " : tx.type === "despesa" ? "− " : "") + money(Math.abs(tx.value)),
        tone: tx.type === "receita" ? "in" : tx.type === "despesa" ? "out" : undefined,
        go: () => dialogs.openTransactionDetail(tx, txs),
      })),
      contas: [
        ...(accounts.data ?? []).filter((a) => has(a.name, a.institution)).map((a) => ({ key: `a-${a.id}`, name: a.name, sub: a.institution || "Conta", value: money(a.balance), go: () => navigate("/contas") })),
        ...(cards.data ?? []).filter((c) => has(c.name, c.institution)).map((c) => ({ key: `c-${c.id}`, name: c.name, sub: `Cartão · ${c.institution}`, go: () => navigate(`/cartoes/${c.id}`) })),
      ],
      categorias: (categories.data ?? []).filter((c) => has(c.name)).map((c) => ({ key: c.id, name: c.name, sub: "Categoria", go: () => navigate("/categorias") })),
      assinaturas: (subscriptions.data?.items ?? []).filter((s) => has(s.name, s.category_name)).map((s) => ({ key: s.id, name: s.name, sub: s.card_name ?? s.account_name, value: `${money(s.value)}/mês`, go: () => navigate("/assinaturas") })),
      metas: (goals.data ?? []).filter((g) => has(g.name, g.category)).map((g) => ({ key: g.id, name: g.name, sub: `${money(g.saved)} de ${money(g.target)}`, go: () => navigate("/patrimonio") })),
      telas: SCREENS.filter((s) => has(s.name, s.where, s.words)).map((s) => ({ key: s.to + s.name, name: s.name, sub: s.where, go: () => navigate(s.to) })),
    };
    return SECTIONS.map((s) => ({ id: s.id, rows: rows[s.id] })).filter((g) => g.rows.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, term, transactions.data, accounts.data, cards.data, categories.data, subscriptions.data, goals.data, hidden]);

  const total = groups.reduce((sum, g) => sum + g.rows.length, 0);
  const shown = section === "tudo" ? groups : groups.filter((g) => g.id === section);
  const loading = active && transactions.isFetching && !transactions.data;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogContent showCloseButton={false} initialFocus={input}
        className="top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none bg-background p-0 sm:max-w-none lg:top-[10vh] lg:left-1/2 lg:h-[min(38rem,80vh)] lg:w-[42rem] lg:-translate-x-1/2 lg:rounded-2xl lg:shadow-2xl"
        data-testid="global-search">
        <DialogTitle className="sr-only">Buscar no FINNOS</DialogTitle>
        <DialogDescription className="sr-only">Lançamentos, contas, categorias, assinaturas, metas e telas.</DialogDescription>
        <div className="flex items-center gap-2 border-b border-border px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:px-4 lg:pt-3">
          <button type="button" onClick={close} aria-label="Fechar busca" className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-muted lg:hidden">
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <label className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl bg-muted px-3.5 text-muted-foreground">
            <Search className="size-5 shrink-0" aria-hidden="true" />
            <span className="sr-only">Buscar no FINNOS</span>
            <input ref={input} type="text" inputMode="search" enterKeyHint="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar lançamentos, contas, telas…"
              className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground" data-testid="global-search-input" />
            {q ? (
              <button type="button" onClick={() => { setQ(""); input.current?.focus(); }} aria-label="Limpar busca" className="grid size-7 place-items-center rounded-full bg-border text-foreground">
                <X className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </label>
          <button type="button" onClick={close} className="hidden h-9 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-muted lg:block">Esc</button>
        </div>

        {active && total > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3" role="group" aria-label="Filtrar por seção">
            {[{ id: "tudo" as const, label: "Tudo", n: total }, ...groups.map((g) => ({ id: g.id, label: SECTIONS.find((s) => s.id === g.id)!.label, n: g.rows.length }))].map((chip) => (
              <button key={chip.id} type="button" aria-pressed={section === chip.id} onClick={() => setSection(chip.id)}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold", section === chip.id ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground hover:bg-muted")}>
                {chip.label}<span className="opacity-70">{chip.n}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-1">
          {!active ? (
            <div className="pt-3">
              {recent.length ? (
                <>
                  <p className="mb-2 mt-2 px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Buscas recentes</p>
                  <div className="flex flex-wrap gap-2">
                    {recent.map((r) => (
                      <button key={r} type="button" onClick={() => setQ(r)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[13px] hover:bg-muted">
                        <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />{r}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <p className="mb-2 mt-6 px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Você pode buscar</p>
              <ul className="space-y-1.5 px-1 text-sm text-muted-foreground">
                <li>Um lançamento: <strong className="text-foreground">mercado</strong>, <strong className="text-foreground">uber</strong>, <strong className="text-foreground">salário</strong></li>
                <li>Uma conta, cartão, categoria, assinatura ou meta</li>
                <li>Uma tela ou ajuste: <strong className="text-foreground">tema</strong>, <strong className="text-foreground">exportar</strong>, <strong className="text-foreground">barra</strong></li>
              </ul>
            </div>
          ) : loading ? (
            <p className="mt-8 text-center text-sm text-muted-foreground" role="status">Buscando…</p>
          ) : total === 0 ? (
            <div className="mt-10 text-center" data-testid="global-search-empty">
              <p className="font-heading text-[17px] font-bold">Nada encontrado para “{debounced}”</p>
              <p className="mt-1 text-sm text-muted-foreground">Confira a escrita ou tente outra palavra.</p>
              {prefs.aiMobile || prefs.aiWeb ? (
                <button type="button" onClick={pick(() => window.dispatchEvent(new CustomEvent("finnos-ai-open")))}
                  className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-primary/10 px-4 text-sm font-bold text-primary dark:text-[#B3A6FF]">
                  <MessageCircleMore className="size-[1.1rem]" aria-hidden="true" />Perguntar na Conversa
                </button>
              ) : null}
            </div>
          ) : (
            shown.map((g) => {
              const meta = SECTIONS.find((s) => s.id === g.id)!;
              const rows = section === "tudo" ? g.rows.slice(0, 3) : g.rows;
              return (
                <section key={g.id} aria-label={meta.label} data-testid={`global-search-${g.id}`}>
                  <div className="mb-1.5 mt-4 flex items-baseline justify-between px-1">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{meta.label} · {g.rows.length}</p>
                    {section === "tudo" && g.rows.length > 3 ? (
                      <button type="button" onClick={() => setSection(g.id)} className="text-[13px] font-bold text-primary dark:text-[#B3A6FF]">Ver {g.rows.length}</button>
                    ) : null}
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-border">
                    {rows.map((r) => (
                      <button key={r.key} type="button" onClick={pick(r.go)}
                        className="flex min-h-14 w-full items-center gap-3 border-b border-border bg-card px-3.5 py-2 text-left last:border-b-0 hover:bg-muted">
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary dark:text-[#B3A6FF]" aria-hidden="true">
                          {g.id === "contas" && r.key.startsWith("c-") ? <CardIcon className="size-[1.1rem]" /> : <meta.icon className="size-[1.1rem]" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{r.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>
                        </span>
                        {r.value ? (
                          <span className={cn("shrink-0 text-sm font-semibold tabular-nums", r.tone === "in" ? "text-income" : r.tone === "out" ? "text-expense" : "text-muted-foreground")}>{r.value}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
