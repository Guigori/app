/** There is an in-app screen to return to (React Router keeps its index in history.state). */
export function canGoBack(): boolean {
  return ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
}
