/** After a new account or card is saved, the app offers to bring its last 90 days. */
const EVENT = "finnos:offer-statement-import";

export function offerStatementImport(target: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: target }));
}

export function onStatementImportOffer(listener: (target: string) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<string>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
