import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useDragControls, type PanInfo } from "motion/react";

/** Far enough, or fast enough, and letting go closes it. */
export const CLOSE_DISTANCE = 90;
export const CLOSE_SPEED = 600;

/**
 * A bottom sheet that closes when dragged down, like the native ones. Spread `panel` on the sheet's
 * motion element and `grip` on the part that starts the drag (the handle and the title row). Pass
 * `whole: true` for short sheets with nothing to scroll: then the drag starts anywhere on them.
 * Short of the mark it springs back; buttons inside still take taps.
 */
export function useDragToClose(onClose: () => void, { whole = false, enabled = true }: { whole?: boolean; enabled?: boolean } = {}) {
  const controls = useDragControls();
  const close = useRef(onClose);
  close.current = onClose;
  const panel = enabled ? {
    drag: "y" as const,
    dragControls: controls,
    dragListener: whole,
    dragConstraints: { top: 0, bottom: 0 },
    dragElastic: { top: 0, bottom: 0.8 },
    dragMomentum: false,
    onDragEnd: (_: unknown, info: PanInfo) => {
      if (info.offset.y > CLOSE_DISTANCE || info.velocity.y > CLOSE_SPEED) close.current();
    },
  } : {};
  const grip = enabled ? {
    onPointerDown: (event: ReactPointerEvent) => controls.start(event),
    style: { touchAction: "none" as const },
    "data-sheet-grip": "",
  } : {};
  return { panel, grip };
}
