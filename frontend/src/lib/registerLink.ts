/**
 * Links that open Registro inteligente already filled in, from Apple Shortcuts or the Wallet
 * "Transação" automation. Data travels after "#", so it never reaches the server (or its logs).
 *   #texto=café 3,80 e uber 14
 *   #valor=R$ 12,50&nome=Padaria Pão Quente&cartao=Nubank
 */
export interface RegisterLink { sentence: string; source: "atalho" | "applepay" }

export function readRegisterLink(hash: string): RegisterLink | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const text = params.get("texto")?.trim();
  if (text) return { sentence: text.slice(0, 300), source: "atalho" };
  const value = params.get("valor")?.trim();
  if (!value) return null;
  // The automation hands over the amount as the phone shows it ("R$ 12,50", "12.5" or "-12,50").
  const amount = value.replace(/[^\d,.]/g, "");
  const name = (params.get("nome") ?? "").trim().slice(0, 80) || "Compra";
  const card = (params.get("cartao") ?? "").trim().slice(0, 60);
  return { sentence: [name, amount, card ? `no ${card}` : ""].filter(Boolean).join(" "), source: "applepay" };
}

/** The links people paste into Shortcuts, for this FINNOS address. */
export function registerLinkBase(origin: string): string {
  return `${origin}/registro-inteligente#`;
}
