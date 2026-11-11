/**
 * Início and Análise as the person builds them: a grid of library analyses in fixed sizes, like the iPhone.
 * Hold a widget (or "Editar") to edit: − removes, the corner handle jumps to the next size, drag to move,
 * "+" opens the gallery, ✓ saves. Outside edit mode a tap on a Pequeno/Médio widget opens its analysis.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Check, Minus, Plus, RotateCcw, SlidersHorizontal } from "lucide-react";
import { insightById, nextSize, SIZE_CLASS, SIZE_LABEL, type WidgetConfig, type WidgetSize } from "@/lib/insights/registry";
import { newKey, resetLayout, saveLayout, useLayout, type PlacedWidget, type Surface } from "@/lib/insights/layout";
import { cn } from "@/lib/utils";
import { InsightWidget, type WidgetSlots } from "@/components/insights/widgets";
import { WidgetGallery } from "@/components/insights/WidgetGallery";
import { useCards } from "@/components/insights/useInsightData";

export function WidgetBoard({ surface, slots, header, emptyText }: { surface: Surface; slots?: WidgetSlots; header?: ReactNode; emptyText?: string }) {
  const saved = useLayout(surface);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PlacedWidget[]>(saved);
  const [gallery, setGallery] = useState(false);
  const navigate = useNavigate();
  const cards = useCards();
  const hasCards = Boolean(cards.data?.some((c) => c.active));
  const press = useRef<number | undefined>(undefined);
  useEffect(() => { if (!editing) setDraft(saved); }, [saved, editing]);
  // "?editar=1" (Configurações → Painel da Home) opens straight in edit mode.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (surface !== "inicio" || params.get("editar") !== "1") return;
    setDraft(saved); setEditing(true);
    const copy = new URLSearchParams(params); copy.delete("editar"); setParams(copy, { replace: true });
    // Only on arrival with the parameter.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const list = (editing ? draft : saved).filter((w) => insightById(w.id)?.requires !== "cards" || hasCards || !cards.data);

  const start = () => { setDraft(saved); setEditing(true); if (navigator.vibrate) navigator.vibrate(10); };
  const done = () => { saveLayout(surface, draft); setEditing(false); toast.success("Painel salvo."); };
  const add = (id: string, size: WidgetSize, config?: WidgetConfig) => {
    const next = [...(editing ? draft : saved), { key: newKey(), id, size, config }];
    if (editing) setDraft(next); else saveLayout(surface, next);
    toast.success(`${insightById(id)?.title ?? "Análise"} adicionada.`);
  };
  const remove = (key: string) => setDraft((d) => d.filter((w) => w.key !== key));
  const resize = (key: string) => setDraft((d) => d.map((w) => { const def = insightById(w.id); return w.key === key && def ? { ...w, size: nextSize(def, w.size) } : w; }));
  const move = (key: string, overKey: string) => setDraft((d) => {
    const from = d.findIndex((w) => w.key === key), to = d.findIndex((w) => w.key === overKey);
    if (from < 0 || to < 0 || from === to) return d;
    const copy = [...d]; const [item] = copy.splice(from, 1); copy.splice(to, 0, item); return copy;
  });
  const moveBy = (key: string, delta: number) => setDraft((d) => {
    const i = d.findIndex((w) => w.key === key), j = i + delta;
    if (i < 0 || j < 0 || j >= d.length) return d;
    const copy = [...d]; [copy[i], copy[j]] = [copy[j], copy[i]]; return copy;
  });
  // Holding a widget for half a second enters edit mode, like the iPhone.
  const holdStart = () => { if (editing) return; window.clearTimeout(press.current); press.current = window.setTimeout(start, 550); };
  const holdEnd = () => window.clearTimeout(press.current);

  return (
    <section className="space-y-3" data-testid={`widget-board-${surface}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">{header}</div>
        {editing ? (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { resetLayout(surface); setEditing(false); toast("Painel padrão restaurado."); }} aria-label="Restaurar padrão" className="grid size-10 place-items-center rounded-full border border-border bg-card"><RotateCcw className="size-4" /></button>
            <button type="button" onClick={() => setGallery(true)} aria-label="Adicionar widget" className="grid size-10 place-items-center rounded-full border border-border bg-card" data-testid="widget-board-add"><Plus className="size-5" /></button>
            <button type="button" onClick={done} aria-label="Concluído" className="grid h-10 w-14 place-items-center rounded-full bg-primary text-primary-foreground" data-testid="widget-board-done"><Check className="size-5" /></button>
          </div>
        ) : (
          <button type="button" onClick={start} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm font-medium" data-testid="widget-board-edit"><SlidersHorizontal className="size-4" />Editar</button>
        )}
      </div>

      {list.length === 0 ? (
        <button type="button" onClick={() => setGallery(true)} className="flex w-full flex-col items-center gap-2 rounded-[24px] border border-dashed border-border px-6 py-10 text-center" data-testid="widget-board-empty">
          <Plus className="size-6 text-primary" />
          <span className="font-semibold">Adicionar análise</span>
          <span className="text-sm text-muted-foreground">{emptyText ?? "Escolha na biblioteca e monte do seu jeito."}</span>
        </button>
      ) : (
        <div className="grid grid-flow-row-dense grid-cols-4 gap-3 dashboard:grid-cols-12" data-testid="widget-grid">
          {list.map((w, i) => {
            const def = insightById(w.id)!;
            const small = w.size === "S" || w.size === "M";
            const to = def.to(w.config ?? {});
            return (
              <motion.div key={w.key} layout data-widget-key={w.key} data-testid={`widget-${w.id}`}
                className={cn("relative", SIZE_CLASS[w.size], editing && "touch-none select-none")}
                drag={editing} dragSnapToOrigin dragElastic={0.6} whileDrag={{ scale: 1.04, zIndex: 50 }}
                onDragEnd={(event) => {
                  const pt = "changedTouches" in event ? (event as TouchEvent).changedTouches[0] : (event as PointerEvent);
                  const over = document.elementsFromPoint(pt.clientX, pt.clientY).map((el) => el.closest<HTMLElement>("[data-widget-key]")).find((el) => el && el.dataset.widgetKey !== w.key);
                  if (over?.dataset.widgetKey) move(w.key, over.dataset.widgetKey);
                }}
                animate={editing ? { rotate: [0, -0.7, 0.7, 0] } : { rotate: 0 }}
                transition={editing ? { rotate: { repeat: Infinity, duration: 0.5 + (i % 3) * 0.06 } } : undefined}
                onPointerDown={holdStart} onPointerUp={holdEnd} onPointerLeave={holdEnd} onPointerCancel={holdEnd}>
                <div className={cn("h-full", editing && "pointer-events-none")}>
                  {small && !editing ? (
                    <div role="link" tabIndex={0} aria-label={`Abrir ${def.title}`} onClick={() => navigate(to)} onKeyDown={(e) => { if (e.key === "Enter") navigate(to); }} className="h-full cursor-pointer rounded-[24px] outline-none transition-transform active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-primary">
                      <InsightWidget id={w.id} size={w.size} config={w.config} slots={slots} className="h-full" />
                    </div>
                  ) : <InsightWidget id={w.id} size={w.size} config={w.config} slots={slots} className="h-full" />}
                </div>
                {editing ? (
                  <>
                    <button type="button" onClick={() => remove(w.key)} aria-label={`Remover ${def.title}`} className="absolute -left-2 -top-2 z-10 grid size-7 place-items-center rounded-full bg-muted-foreground text-background shadow" data-testid={`widget-remove-${w.id}`}><Minus className="size-4" strokeWidth={3} /></button>
                    {def.sizes.length > 1 ? (
                      <button type="button" onClick={() => resize(w.key)} aria-label={`Tamanho: ${SIZE_LABEL[w.size]}. Trocar para ${SIZE_LABEL[nextSize(def, w.size)]}`} className="absolute -bottom-2 -right-2 z-10 grid size-9 place-items-center rounded-full border border-border bg-card shadow" data-testid={`widget-resize-${w.id}`}>
                        <span className="block size-4 rounded-br-[10px] border-b-[3px] border-r-[3px] border-primary" aria-hidden="true" />
                      </button>
                    ) : null}
                    <span className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground backdrop-blur">{SIZE_LABEL[w.size]}</span>
                    {/* Keyboard and screen readers: move without dragging. */}
                    <span className="sr-only"><button type="button" onClick={() => moveBy(w.key, -1)}>Mover {def.title} para antes</button><button type="button" onClick={() => moveBy(w.key, 1)}>Mover {def.title} para depois</button></span>
                  </>
                ) : null}
              </motion.div>
            );
          })}
        </div>
      )}
      <WidgetGallery open={gallery} onClose={() => setGallery(false)} onAdd={add} />
    </section>
  );
}
