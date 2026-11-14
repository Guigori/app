import { useEffect, useRef, type RefObject } from "react";
import { gestureBlockedBy, overlayOpen } from "@/lib/gestures/gestureTarget";

/** A swipe that changes the screen. */
export type PageGestureKind = "back" | "prev" | "next";

/** What the current screen allows. Read when a touch starts, so it always matches the screen. */
export interface PageGestureHandlers {
  /** Inner screens: a swipe to the right, from anywhere, goes back. */
  back?: () => void;
  /** Bottom-bar tabs: a swipe to the right shows the tab before, to the left the tab after. */
  prev?: () => void;
  next?: () => void;
  /** Bottom-bar tabs: dragging in from the left edge opens the menu. */
  menu?: () => void;
  /** Pulling down at the top of the screen. */
  refresh?: () => Promise<unknown>;
}

const EDGE = 24;          // px from the left edge that count as "from the edge"
const DECIDE = 10;        // px moved before the gesture picks a direction
const PULL_MAX = 112;     // how far the refresh indicator follows the finger
const PULL_ARM = 72;      // release past this and it refreshes
const PULL_REST = 56;     // where it waits while refreshing
const SLIDE_MS = 180;

type Mode = "none" | "menu" | "pull" | PageGestureKind;

interface Touch0 { x0: number; y0: number; t0: number; target: EventTarget | null; edge: boolean; mode: Mode | null; dx: number; pull: number; armed: boolean; h: PageGestureHandlers }

/**
 * Native-app gestures for the page under the header: swipe right to go back, swipe between the
 * bottom-bar tabs, drag in from the edge for the menu and pull down to refresh. The page follows the
 * finger; letting go short of the mark puts it back.
 */
export function usePageGestures({ surface, pull, getHandlers, onCommit, enabled = true }: {
  surface: RefObject<HTMLElement | null>;
  pull: RefObject<HTMLElement | null>;
  getHandlers: () => PageGestureHandlers;
  /** Called right before the screen changes, with which gesture changed it (for the entry animation). */
  onCommit?: (kind: PageGestureKind) => void;
  enabled?: boolean;
}): void {
  const handlers = useRef(getHandlers);
  handlers.current = getHandlers;
  const commit = useRef(onCommit);
  commit.current = onCommit;

  useEffect(() => {
    if (!enabled) return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    let cur: Touch0 | null = null;
    let refreshing = false;
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => { const id = window.setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };

    const paintSurface = (x: number, animate: boolean, fade?: number) => {
      const el = surface.current;
      if (!el) return;
      const width = el.clientWidth || window.innerWidth;
      el.style.transition = animate ? `transform ${SLIDE_MS}ms cubic-bezier(.2,.8,.2,1), opacity ${SLIDE_MS}ms ease-out` : "none";
      el.style.transform = x ? `translate3d(${x}px,0,0)` : "";
      el.style.opacity = fade !== undefined ? String(fade) : x ? String(1 - Math.min(0.35, (Math.abs(x) / width) * 0.35)) : "";
    };
    const resetSurface = () => {
      const el = surface.current;
      if (!el) return;
      el.style.transition = "none";
      el.style.transform = "";
      el.style.opacity = "";
    };

    const paintPull = (d: number, animate: boolean) => {
      const el = pull.current;
      if (!el) return;
      el.style.transition = animate ? "transform 220ms cubic-bezier(.2,.8,.2,1), opacity 220ms" : "none";
      el.style.transform = `translateY(${d - 64}px)`;
      el.style.opacity = String(Math.min(1, d / PULL_ARM));
      el.dataset.armed = d >= PULL_ARM ? "true" : "false";
      const arrow = el.querySelector<HTMLElement>("[data-pull-arrow]");
      if (arrow) arrow.style.transform = `rotate(${Math.min(1, d / PULL_ARM) * 180}deg)`;
    };

    const startRefresh = (refresh: () => Promise<unknown>) => {
      refreshing = true;
      const el = pull.current;
      if (el) {
        el.dataset.refreshing = "true";
        const live = el.querySelector("[data-pull-status]");
        if (live) live.textContent = "Atualizando";
      }
      paintPull(PULL_REST, true);
      const minimum = new Promise((resolve) => later(() => resolve(null), 600));
      void Promise.allSettled([refresh(), minimum]).then(() => {
        refreshing = false;
        if (el) {
          el.dataset.refreshing = "false";
          const live = el.querySelector("[data-pull-status]");
          if (live) live.textContent = "Atualizado";
        }
        paintPull(0, true);
      });
    };

    const decide = (g: Touch0, dx: number, dy: number): Mode => {
      const h = g.h;
      if (Math.abs(dx) > Math.abs(dy) * 1.2) {
        if (gestureBlockedBy(g.target, "x", dx)) return "none";
        if (g.edge && dx > 0 && h.menu) return "menu";
        if (dx > 0 && h.back) return "back";
        if (dx > 0 && h.prev) return "prev";
        if (dx < 0 && h.next) return "next";
        return "none";
      }
      if (dy > 0 && h.refresh && !refreshing && window.scrollY <= 0 && !gestureBlockedBy(g.target, "y", dy)) return "pull";
      return "none";
    };

    // A touch keeps the element it started on as its target. If the page re-renders and drops that
    // element mid-gesture, its touchmove/touchend no longer bubble up to window: listen on it too.
    let seen: Event | null = null;
    let held: EventTarget | null = null;
    const once = (e: Event) => { if (e === seen) return false; seen = e; return true; };
    const release = () => {
      if (!held) return;
      held.removeEventListener("touchmove", onMove as EventListener);
      held.removeEventListener("touchend", onEnd);
      held.removeEventListener("touchcancel", cancel);
      held = null;
    };

    const onStart = (e: TouchEvent) => {
      if (!once(e)) return;
      // A gesture whose end never arrived must not leave the page shifted.
      if (cur && (cur.mode === "back" || cur.mode === "prev" || cur.mode === "next")) paintSurface(0, true);
      release();
      cur = null;
      if (desktop.matches || e.touches.length !== 1 || overlayOpen()) return;
      const t = e.touches[0];
      cur = { x0: t.clientX, y0: t.clientY, t0: performance.now(), target: e.target, edge: t.clientX <= EDGE, mode: null, dx: 0, pull: 0, armed: false, h: handlers.current() };
      if (e.target && e.target !== window) {
        held = e.target;
        held.addEventListener("touchmove", onMove as EventListener, { passive: false });
        held.addEventListener("touchend", onEnd, { passive: true });
        held.addEventListener("touchcancel", cancel, { passive: true });
      }
    };

    function onMove(e: TouchEvent) {
      if (!once(e)) return;
      const g = cur;
      if (!g) return;
      if (e.touches.length !== 1) { cancel(); return; }
      const t = e.touches[0];
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (!g.mode) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < DECIDE) return;
        g.mode = decide(g, dx, dy);
      }
      if (g.mode === "none") return;
      if (g.mode === "menu") {
        if (dx > 60 && Math.abs(dy) < 50) { cur = null; g.h.menu?.(); }
        return;
      }
      if (e.cancelable) e.preventDefault();
      if (g.mode === "pull") {
        g.pull = Math.min(PULL_MAX, Math.max(0, dy) * 0.5);
        const armed = g.pull >= PULL_ARM;
        if (armed && !g.armed) navigator.vibrate?.(8);
        g.armed = armed;
        paintPull(g.pull, false);
        return;
      }
      g.dx = g.mode === "next" ? Math.min(0, dx) : Math.max(0, dx);
      paintSurface(g.dx, false);
    }

    function cancel(e?: Event) {
      if (e && !once(e)) return;
      release();
      const g = cur;
      cur = null;
      if (!g || !g.mode) return;
      if (g.mode === "pull" && !refreshing) paintPull(0, true);
      if (g.mode === "back" || g.mode === "prev" || g.mode === "next") paintSurface(0, true);
    }

    function onEnd(e: Event) {
      if (!once(e)) return;
      release();
      const g = cur;
      cur = null;
      if (!g || !g.mode || g.mode === "none" || g.mode === "menu") return;
      if (g.mode === "pull") {
        if (g.pull >= PULL_ARM && g.h.refresh) startRefresh(g.h.refresh);
        else paintPull(0, true);
        return;
      }
      const kind = g.mode;
      const width = surface.current?.clientWidth || window.innerWidth;
      const speed = Math.abs(g.dx) / Math.max(1, performance.now() - g.t0);
      const go = Math.abs(g.dx) > width * 0.3 || (speed > 0.45 && Math.abs(g.dx) > 40);
      if (!go) { paintSurface(0, true); return; }
      paintSurface(kind === "next" ? -width : width, true, 0);
      later(() => {
        commit.current?.(kind);
        g.h[kind]?.();
        requestAnimationFrame(resetSurface);
      }, SLIDE_MS);
    }

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", cancel);
      release();
      timers.forEach((id) => window.clearTimeout(id));
      resetSurface();
    };
  }, [enabled, surface, pull]);
}
