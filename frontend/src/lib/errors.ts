import { ApiError } from "@/lib/api";

/** Human-readable pt-BR message from an ApiError (FastAPI detail can be a string or a 422 list). */
export function getApiErrorMessage(
  error: unknown,
  fallback = "Não foi possível concluir a ação. Tente novamente.",
): string {
  if (error instanceof ApiError) {
    if (error.status === 422) return "Verifique os campos do formulário e tente novamente.";
    const detail = (error.body as { detail?: unknown } | null)?.detail;
    if (typeof detail === "string" && detail) return detail;
  }
  return fallback;
}
