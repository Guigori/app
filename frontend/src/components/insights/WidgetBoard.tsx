/**
 * Início and Análise as the person builds them: a grid of library analyses in fixed sizes, like the iPhone.
 * Hold a widget (or "Editar") to edit: − removes, the corner handle jumps to the next size, hold and drag to move.
 * The edit bar floats at the bottom so it is always at hand. Outside edit mode a tap opens the widget's analysis page.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import { toast } from "sonner";
import { Check, Minus, Plus, RotateCcw, SlidersHorizontal } from "lucide-react";
import { detailPath, insightById, nextSize, SIZE_CLASS, SIZE_LABEL, type WidgetConfig, type WidgetSize } from "@/lib/insights/registry";
import { newKey, resetLayout, saveLayout, useLayout, type PlacedWidget, type Surface } from "@/lib/insights/layout";
import { cn } from "@/lib/utils";
import { InsightWidget, type WidgetSlots } from "@/components/insights/widgets";
import { WidgetGallery } from "@/components/insights/WidgetGallery";
import { useCards } from "@/components/insights/useInsightData";

const HOLD_MS = 450;

export function WidgetBoard({ surface, slots, header, emptyText }: { surface: Surface; slots?: WidgetSlots; header?: ReactNode; emptyText?: string }) {
  const saved = useLayout(surface);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PlacedWidget[]>(saved);
  const [gallery, setGallery] = useState(false);
  const cards = useCards();
  const hasCards = Boolean(cards.data?.some((c) => c.active));
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

  const start = () => { setDraft(saved); setEditing(true); navigator.vibrate?.(10); };
  const done = () => { saveLayout(surface, draft); setEditing(false); toast.success("Painel salvo."); };
  const add = (id: string, size: WidgetSize, config?: WidgetConfig) => {
    const next = [...(editing ? draft : saved), { key: newKey(), id, size, config }];
    if (editing) setDraft(next); else saveLayout(surface, next);
    toast.success(`${insightById(id)?.title ?? "Análise"} adicionada.`);
  };
  const remove = (key: string) => setDraft((d) => d.filter((w) => w.key !== key));
  const resize = (key: string) => setDraft((d) => d.map((w) => { const def = insightById(w.id); return w.key === key && def ? { ...w, size: nextSize(def, w.size) } : w; }));
  const moveTo = (key: string, overKey: string) => setDraft((d) => {
    const from = d.findIndex((w) => w.key === key), to = d.findIndex((w) => w.key === overKey);
    if (from < 0 || to < 0 || from === to) return d;
    const copy = [...d]; const [item] = copy.splice(from, 1); copy.splice(to, 0, item); return copy;
  });
  const moveBy = (key: string, delta: number) => setDraft((d) => {
    const i = d.findIndex((w) => w.key === key), j = i + delta;
    if (i < 0 || j < 0 || j >= d.length) return d;
    const copy = [...d]; [copy[i], copy[j]] = [copy[j], copy[i]]; return copy;
  });

  return (
    <section className="space-y-3" data-testid={`widget-board-${surface}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">{header}</div>
        {!editing ? (
          <button type="button" onClick={start} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm font-medium" data-testid="widget-board-edit"><SlidersHorizontal className="size-4" />Editar</button>
        ) : <span className="text-sm text-muted-foreground">Segure e arraste para mover</span>}
      </div>

      {list.length === 0 ? (
        <button type="button" onClick={() => setGallery(true)} className="flex w-full flex-col items-center gap-2 rounded-3xl border border-dashed border-border px-6 py-10 text-center" data-testid="widget-board-empty">
          <Plus className="size-6 text-primary" />
          <span className="font-semibold">Adicionar análise</span>
          <span className="text-sm text-muted-foreground">{emptyText ?? "Escolha na biblioteca e monte do seu jeito."}</span>
        </button>
      ) : (
        <div className="grid grid-flow-row-dense grid-cols-4 gap-3 dashboard:grid-cols-12" data-testid="widget-grid">
          {list.map((w, i) => (
            <BoardItem key={w.key} widget={w} index={i} editing={editing} slots={slots}
              onHold={start} onRemove={() => remove(w.key)} onResize={() => resize(w.key)} onOver={(overKey) => moveTo(w.key, overKey)}
              onMoveBy={(d) => moveBy(w.key, d)} />
          ))}
        </div>
      )}

      {/* Edit bar: floats above the navigation, so the actions are at hand wherever the page is scrolled. */}
      {typeof document !== "undefined" ? createPortal(
        <AnimatePresence>
          {editing ? (
            <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              className="fixed inset-x-0 z-[90] flex justify-center px-4" style={{ bottom: "calc(env(safe-area-inset-bottom) + 6.5rem)" }} data-testid="widget-edit-bar">
              <div className="flex items-center gap-2 rounded-full border border-border bg-background/90 p-1.5 shadow-xl backdrop-blur-xl">
                <button type="button" onClick={() => { resetLayout(surface); setEditing(false); toast("Painel padrão restaurado."); }} aria-label="Restaurar padrão" className="grid size-11 place-items-center rounded-full hover:bg-muted"><RotateCcw className="size-4" /></button>
                <button type="button" onClick={() => setGallery(true)} className="inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold hover:bg-muted" data-testid="widget-board-add"><Plus className="size-4" />Adicionar</button>
                <button type="button" onClick={done} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground" data-testid="widget-board-done"><Check className="size-4" />Concluído</button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      ) : null}
      <WidgetGallery open={gallery} onClose={() => setGallery(false)} onAdd={add} />
    </section>
  );
}

function BoardItem({ widget: w, index, editing, slots, onHold, onRemove, onResize, onOver, onMoveBy }: {
  widget: PlacedWidget; index: number; editing: boolean; slots?: WidgetSlots;
  onHold: () => void; onRemove: () => void; onResize: () => void; onOver: (overKey: string) => void; onMoveBy: (delta: number) => void;
}) {
  const def = insightById(w.id)!;
  const navigate = useNavigate();
  const controls = useDragControls();
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const held = useRef(false);
  // Swap once per widget passed over, not on every frame above it.
  const lastOver = useRef<string | null>(null);

  // While dragging, the page must not scroll under the finger (non-passive so it can be prevented).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const block = (e: TouchEvent) => { if (draggingRef.current) e.preventDefault(); };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);

  const cancel = () => { window.clearTimeout(timer.current); startPoint.current = null; };
  const onPointerDown = (e: React.PointerEvent) => {
    held.current = false;
    startPoint.current = { x: e.clientX, y: e.clientY };
    const native = e.nativeEvent;
    window.clearTimeout(timer.current);
    // A short hold picks the widget up (in edit mode) or starts editing; moving first lets the page scroll.
    timer.current = window.setTimeout(() => {
      held.current = true;
      if (!editing) { onHold(); return; }
      draggingRef.current = true; setDragging(true); navigator.vibrate?.(8);
      controls.start(native);
    }, editing ? 220 : HOLD_MS);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = startPoint.current;
    if (s && !draggingRef.current && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) cancel();
  };
  // The widget under the finger (by its box: the one being dragged covers the point itself).
  const overAt = (x: number, y: number) => [...document.querySelectorAll<HTMLElement>("[data-widget-key]")].find((el) => {
    if (el.dataset.widgetKey === w.key) return false;
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  const open = (e: React.MouseEvent) => {
    if (editing || held.current) return;
    // Buttons and links inside a widget (pay a bill, open a signal) keep their own action.
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input") && ref.current?.contains(target.closest("button, a, input"))) return;
    navigate(detailPath(w.id, w.config));
  };

  return (
    <motion.div ref={ref} layout="position" data-widget-key={w.key} data-testid={`widget-${w.id}`}
      className={cn("relative", SIZE_CLASS[w.size], dragging && "z-50")}
      drag={editing} dragListener={false} dragControls={controls} dragSnapToOrigin dragElastic={0.9}
      whileDrag={{ scale: 1.05, boxShadow: "0 18px 40px rgba(0,0,0,0.25)" }}
      onDrag={(event) => { const p = "touches" in event ? (event as TouchEvent).touches[0] : (event as PointerEvent); if (!p) return; const over = overAt(p.clientX, p.clientY); const key = over?.dataset.widgetKey ?? null; if (key && key !== lastOver.current) { lastOver.current = key; onOver(key); } }}
      onDragEnd={() => { draggingRef.current = false; lastOver.current = null; setDragging(false); }}
      animate={editing && !dragging ? { rotate: [0, -0.6, 0.6, 0] } : { rotate: 0 }}
      transition={editing && !dragging ? { rotate: { repeat: Infinity, duration: 0.45 + (index % 3) * 0.06 } } : { layout: { type: "spring", stiffness: 500, damping: 40 } }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={cancel} onPointerCancel={cancel} onClick={open}
      role={editing ? undefined : "link"} aria-label={editing ? undefined : `Abrir ${def.title}`}
      style={{ touchAction: dragging ? "none" : "pan-y" }}>
      <div className={cn("h-full", editing ? "pointer-events-none" : "cursor-pointer transition-transform active:scale-[0.985]")}>
        <InsightWidget id={w.id} size={w.size} config={w.config} slots={slots} className="h-full" />
      </div>
      {editing ? (
        <>
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onRemove} aria-label={`Remover ${def.title}`} className="absolute -left-2 -top-2 z-10 grid size-7 place-items-center rounded-full bg-foreground/75 text-background shadow" data-testid={`widget-remove-${w.id}`}><Minus className="size-4" strokeWidth={3} /></button>
          {def.sizes.length > 1 ? (
            <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onResize} aria-label={`Tamanho ${SIZE_LABEL[w.size]}. Trocar para ${SIZE_LABEL[nextSize(def, w.size)]}`} className="absolute -bottom-2 -right-2 z-10 grid size-9 place-items-center rounded-full border border-border bg-card shadow" data-testid={`widget-resize-${w.id}`}>
              <span className="block size-3.5 rounded-br-[9px] border-b-[3px] border-r-[3px] border-foreground/70" aria-hidden="true" />
            </button>
          ) : null}
          <span className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground backdrop-blur">{SIZE_LABEL[w.size]}</span>
          <span className="sr-only"><button type="button" onClick={() => onMoveBy(-1)}>Mover {def.title} para antes</button><button type="button" onClick={() => onMoveBy(1)}>Mover {def.title} para depois</button></span>
        </>
      ) : null}
    </motion.div>
  );
}
