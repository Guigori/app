/** "Adicionar widget": the library's gallery, like the iPhone's. Search, pick an analysis, swipe its sizes, add. */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Plus, Search, Star, X } from "lucide-react";
import { INSIGHTS, SIZE_LABEL, THEMES, type InsightDef, type WidgetConfig, type WidgetSize } from "@/lib/insights/registry";
import { cn } from "@/lib/utils";
import { InsightWidget } from "@/components/insights/widgets";
import { useCards } from "@/components/insights/useInsightData";

const PREVIEW_H: Record<WidgetSize, string> = { S: "h-[10.5rem] w-[54%]", M: "h-[10.5rem] w-full", L: "w-full", XL: "w-full" };

export function WidgetGallery({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (id: string, size: WidgetSize, config?: WidgetConfig) => void }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<InsightDef | null>(null);
  const cards = useCards();
  const hasCards = Boolean(cards.data?.some((c) => c.active));
  const list = useMemo(() => {
    const q = query.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    return INSIGHTS.filter((d) => (d.requires !== "cards" || hasCards) && (!q || `${d.title} ${d.description} ${d.theme}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(q)));
  }, [query, hasCards]);
  const close = () => { setPicked(null); setQuery(""); onClose(); };
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-[120] flex items-end bg-black/50 dashboard:items-center dashboard:justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
          <motion.div role="dialog" aria-modal="true" aria-label="Adicionar widget" onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-border bg-background dashboard:max-w-xl dashboard:rounded-[28px]"
            initial={{ y: 60 }} animate={{ y: 0 }} exit={{ y: 60 }} transition={{ type: "spring", damping: 30, stiffness: 320 }} data-testid="widget-gallery">
            <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-muted" aria-hidden="true" />
            {picked ? <Detail def={picked} onBack={() => setPicked(null)} onAdd={(size, config) => { onAdd(picked.id, size, config); close(); }} /> : (
              <div className="flex min-h-0 flex-col">
                <div className="flex items-center gap-2 px-4 pt-3">
                  <label className="flex h-11 flex-1 items-center gap-2 rounded-full bg-muted px-4">
                    <Search className="size-4 text-muted-foreground" aria-hidden="true" />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar análises" className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Buscar análises" data-testid="widget-gallery-search" />
                  </label>
                  <button type="button" onClick={close} aria-label="Fechar" className="grid size-11 place-items-center rounded-full bg-muted"><X className="size-5" /></button>
                </div>
                <div className="min-h-0 overflow-y-auto px-4 pb-8 pt-3">
                  {THEMES.map((theme) => {
                    const items = list.filter((d) => d.theme === theme);
                    if (!items.length) return null;
                    return (
                      <section key={theme} className="mb-4">
                        <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[1.5px] text-muted-foreground">{theme}</h3>
                        <ul className="space-y-2">
                          {items.map((d) => (
                            <li key={d.id}>
                              <button type="button" onClick={() => setPicked(d)} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left hover:bg-muted/50" data-testid={`widget-gallery-item-${d.id}`}>
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-1.5 font-semibold">{d.title}{d.star ? <Star className="size-3.5 fill-current text-[var(--chart-3)]" aria-label="Novo" /> : null}</span>
                                  <span className="mt-0.5 block text-xs text-muted-foreground">{d.description}</span>
                                </span>
                                <span className="flex shrink-0 gap-1">{d.sizes.map((s) => <span key={s} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{s === "XL" ? "XG" : s === "S" ? "P" : s === "M" ? "M" : "G"}</span>)}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                  {!list.length ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma análise com esse nome.</p> : null}
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
        <button type="button" onClick={onBack} aria-label="Voltar à galeria" className="grid size-11 place-items-center rounded-full bg-muted"><ArrowLeft className="size-5" /></button>
        <p className="text-sm font-semibold text-muted-foreground">{def.theme}</p>
      </div>
      <div className="min-h-0 overflow-y-auto pb-4">
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
