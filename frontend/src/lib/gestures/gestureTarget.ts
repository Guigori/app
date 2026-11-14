/** Where a page gesture must not start: something under the finger already uses that drag. */

const IGNORE_SELECTOR = [
  "[data-gesture='ignore']",
  "input[type='range']",
  "[role='slider']",
  "textarea",
  "[contenteditable='true']",
  "select",
].join(",");

/** Something inside scrolls (or can scroll) along this axis, so the drag belongs to it. */
function scrollsAlong(el: Element, axis: "x" | "y", delta: number): boolean {
  const style = window.getComputedStyle(el);
  if (axis === "x") {
    if (!/(auto|scroll)/.test(style.overflowX)) return false;
    if (el.scrollWidth <= el.clientWidth + 1) return false;
    // Dragging right shows what is to the left: only if it is not already at the start (and the reverse).
    return delta > 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  }
  if (!/(auto|scroll)/.test(style.overflowY)) return false;
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  return delta > 0 ? el.scrollTop > 0 : true;
}

/**
 * True when a page gesture along `axis` should leave this touch alone: a slider, a carousel, a chart
 * that is dragged, an editor, or a box that still has room to scroll in that direction.
 */
export function gestureBlockedBy(target: EventTarget | null, axis: "x" | "y", delta: number): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(IGNORE_SELECTOR)) return true;
  for (let el: Element | null = target; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (scrollsAlong(el, axis, delta)) return true;
  }
  return false;
}

/** A dialog, sheet or menu is open over the page: gestures there belong to it. */
export function overlayOpen(): boolean {
  return Boolean(document.querySelector("[role='dialog'], [role='alertdialog'], [data-slot='sheet-content']"));
}
