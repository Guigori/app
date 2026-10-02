import { useEffect } from "react";

/** Opens something (the nav drawer) when the user drags in from the left screen edge.
 *  Listens to both touch and touch-type pointer events, since mobile browsers differ on
 *  which of the two they emit first. Mouse/pen input is ignored. */
export function useEdgeSwipe(onOpen: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    let startX: number | null = null;
    let startY = 0;
    let fired = false;

    const start = (x: number, y: number) => {
      if (x > 28) {
        startX = null;
        return;
      }
      startX = x;
      startY = y;
      fired = false;
    };

    const move = (x: number, y: number) => {
      if (startX === null || fired) return;
      if (x - startX > 60 && Math.abs(y - startY) < 50) {
        fired = true;
        onOpen();
      }
    };

    const end = () => {
      startX = null;
    };

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch) start(touch.clientX, touch.clientY);
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch) move(touch.clientX, touch.clientY);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") start(event.clientX, event.clientY);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") move(event.clientX, event.clientY);
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", end, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", end);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", end);
    };
  }, [onOpen, enabled]);
}
