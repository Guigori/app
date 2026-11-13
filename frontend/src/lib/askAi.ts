/** Opens the FINNOS IA panel with a question about what is on screen ("Conversar sobre isso"). */
export function askAbout(question: string, context: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent("finnos-ai-open", { detail: { question, context } }));
}
