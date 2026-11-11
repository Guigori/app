/** "Adicionar widget": the library's gallery, like the iPhone's. Search, pick an analysis, swipe its sizes, add. */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Plus, Search, X } from "lucide-react";
import { INSIGHTS, SIZE_LABEL, THEMES, type InsightDef, type WidgetConfig, type WidgetSize } from "@/lib/insights/registry";
import { cn } from "@/lib/utils";
import { InsightWidget } from "@/components/insights/widgets";
import { useCards } from "@/components/insights/useInsightData";

const PREVIEW_H: Record<WidgetSize, string> = { S: "h-[11rem] w-[54%]", M: "h-[11rem] w-full", L: "h-[23rem] w-full", XL: "h-[23rem] w-full" };

export function WidgetGallery({ open, onClose, onAdd, placedIds = [] }: { open: boolean; onClose: () => void; onAdd: (id: string, size: WidgetSize, config?: WidgetConfig) => void; placedIds?: string[] }) {
  const [query, setQuery] = useState("");
  // Theme filter: "todas", "novas" (the newest analyses) or one theme of the library.
  const [theme, setTheme] = useState<string>("todas");
  const [picked, setPicked] = useState<InsightDef | null>(null);
  const cards = useCards();
  const hasCards = Boolean(cards.data?.some((c) => c.active));
  const list = useMemo(() => {
    const q = query.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    return INSIGHTS.filter((d) => (d.requires !== "cards" || hasCards) && (!q || `${d.title} ${d.description} ${d.theme}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(q)));
  }, [query, hasCards]);
  const shown = list.filter((d) => theme === "todas" || (theme === "novas" ? d.star : d.theme === theme));
  const chips = [
    { key: "todas", label: "Todas", count: list.length },
    { key: "novas", label: "Novas", count: list.filter((d) => d.star).length },
    ...THEMES.map((t) => ({ key: t, label: t, count: list.filter((d) => d.theme === t).length })),
  ].filter((c) => c.count > 0 || c.key === "todas");
  const close = () => { setPicked(null); setQuery(""); setTheme("todas"); onClose(); };
  // The page behind stays still while the gallery scrolls.
  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style, html = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden"; document.documentElement.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; document.documentElement.style.overflow = html; };
  }, [open]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-[120] flex touch-none items-end bg-black/50 dashboard:items-center dashboard:justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
          <motion.div role="dialog" aria-modal="true" aria-label="Adicionar widget" onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92dvh] w-full touch-auto flex-col overflow-hidden rounded-t-[28px] border border-border bg-background dashboard:max-w-xl dashboard:rounded-[28px]"
            initial={{ y: 60 }} animate={{ y: 0 }} exit={{ y: 60 }} transition={{ type: "spring", damping: 30, stiffness: 320 }} data-testid="widget-gallery">
            <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-muted" aria-hidden="true" />
            {picked ? <Detail def={picked} onBack={() => setPicked(null)} onAdd={(size, config) => { onAdd(picked.id, size, config); close(); }} /> : (
              <div className="flex min-h-0 flex-col">
                <div className="flex items-center gap-3 px-4 pt-3">
                  <button type="button" onClick={close} aria-label="Fechar" className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-card"><X className="size-5" /></button>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-heading text-lg font-bold leading-tight">Adicionar análise</h2>
                    <p className="text-xs text-muted-foreground">{INSIGHTS.length} análises na biblioteca</p>
                  </div>
                </div>
                {/* Search and themes stay on top while the list scrolls. */}
                <div className="space-y-2.5 border-b border-border/70 px-4 pb-3 pt-3">
                  <label className="flex h-12 items-center gap-2 rounded-2xl border border-border bg-card px-4 focus-within:border-primary">
                    <Search className="size-4.5 text-primary" aria-hidden="true" />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar: fatura, metas, gastos…" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" aria-label="Buscar análises" data-testid="widget-gallery-search" />
                    {query ? <button type="button" onClick={() => setQuery("")} aria-label="Limpar busca" className="grid size-6 place-items-center rounded-full bg-muted"><X className="size-3.5" /></button> : null}
                  </label>
                  <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Temas" data-testid="widget-gallery-themes">
                    {chips.map((c) => (
                      <button key={c.key} type="button" role="tab" aria-selected={theme === c.key} onClick={() => setTheme(c.key)}
                        className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors", theme === c.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground")}>
                        {c.label}<span className={cn("text-xs tabular-nums", theme === c.key ? "text-primary-foreground/80" : "text-muted-foreground")}>{c.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-8 pt-3">
                  {THEMES.map((group) => {
                    const items = shown.filter((d) => d.theme === group);
                    if (!items.length) return null;
                    return (
                      <section key={group} className="mb-4">
                        <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{group} · {items.length}</h3>
                        <ul className="space-y-2">
                          {items.map((d) => (
                            <li key={d.id}>
                              <button type="button" onClick={() => setPicked(d)} className="flex w-full items-center gap-3 rounded-3xl border border-border/80 bg-card p-4 text-left shadow-sm hover:bg-muted/50" data-testid={`widget-gallery-item-${d.id}`}>
                                <span className="min-w-0 flex-1">
                                  <span className="flex flex-wrap items-center gap-2 font-semibold">{d.title}{d.star ? <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">Novo</span> : null}{placedIds.includes(d.id) ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">No painel</span> : null}</span>
                                  <span className="mt-0.5 block text-xs text-muted-foreground">{d.description}</span>
                                </span>
                                <span className="flex shrink-0 gap-1">{d.sizes.map((s) => <span key={s} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{s === "S" ? "P" : s === "M" ? "M" : "G"}</span>)}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                  {!shown.length ? <p className="py-6 text-center text-sm text-muted-foreground">{query ? "Nenhuma análise com esse nome." : "Nenhuma análise neste tema."}</p> : null}
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/** One analysis: its sizes side by side (swipe), with the person's own data, and the card it should look at. */
function Detail({ def, onBack, onAdd }: { def: InsightDef; onBack: () => void; onAdd: (size: WidgetSize, config?: WidgetConfig) => void }) {
  const [index, setIndex] = useState(Math.max(0, def.sizes.indexOf(def.defaultSize)));
  const [cardId, setCardId] = useState<string | null>(null);
  const cards = useCards();
  const strip = useRef<HTMLDivElement>(null);
  const size = def.sizes[index];
  // Open on the default size, without animating there.
  useEffect(() => { const el = strip.current; if (el) el.scrollLeft = index * (el.clientWidth - 48); /* only on open */ // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const go = (i: number) => { setIndex(i); strip.current?.children[i]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); };
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 pt-3">
        <button type="button" onClick={onBack} aria-label="Voltar à galeria" className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-card"><ArrowLeft className="size-5" /></button>
        <p className="text-sm font-semibold text-muted-foreground">{def.theme}</p>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain pb-4">
        <div className="px-6 pt-3 text-center">
          <h2 className="font-heading text-2xl font-bold">{def.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{def.description}</p>
        </div>
        <div ref={strip} className="mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 [scrollbar-width:none]"
          onScroll={(e) => { const el = e.currentTarget; const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth - 48)); if (i !== index && def.sizes[i]) setIndex(i); }}>
          {def.sizes.map((s) => (
            <div key={s} className="flex w-[calc(100%-1rem)] shrink-0 snap-center flex-col items-center justify-center rounded-3xl bg-muted/40 p-3" aria-label={`Prévia ${SIZE_LABEL[s]}`}>
              <div className={cn("pointer-events-none max-h-[26rem] overflow-hidden", PREVIEW_H[s])} aria-hidden="true">
                <InsightWidget id={def.id} size={s} config={{ cardId }} className="h-full" />
              </div>
              <p className="mt-2 text-xs font-semibold text-muted-foreground">{SIZE_LABEL[s]}</p>
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-center gap-2" role="tablist" aria-label="Tamanhos">
          {def.sizes.map((s, i) => <button key={s} type="button" role="tab" aria-selected={i === index} aria-label={SIZE_LABEL[s]} onClick={() => go(i)} className={cn("size-2 rounded-full", i === index ? "bg-foreground" : "bg-muted-foreground/40")} />)}
        </div>
        {def.cardScope && cards.data?.some((c) => c.active) ? (
          <div className="mt-4 flex gap-2 overflow-x-auto px-6" role="group" aria-label="Qual cartão">
            {[{ id: null as string | null, name: "Todos" }, ...cards.data.filter((c) => c.active)].map((c) => (
              <button key={c.id ?? "todos"} type="button" onClick={() => setCardId(c.id)} aria-pressed={cardId === c.id}
                className={cn("h-9 shrink-0 rounded-full border px-4 text-sm font-semibold", cardId === c.id ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{c.name}</button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="border-t border-border p-4">
        <button type="button" onClick={() => onAdd(size, def.cardScope ? { cardId } : undefined)} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary font-semibold text-primary-foreground" data-testid="widget-gallery-add">
          <Plus className="size-5" aria-hidden="true" />Adicionar widget · {SIZE_LABEL[size]}
        </button>
      </div>
    </div>
  );
}
