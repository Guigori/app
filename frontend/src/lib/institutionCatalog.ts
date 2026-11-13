/**
 * Known banks and benefit providers for the Carteira picker. Same list as the
 * server (finnos/lib/institution_catalog.py), kept in sync by a test. Local
 * mode uses it directly; signed-in mode reads /institutions/catalog.
 * Only an exact name match takes a catalog color: never an alias.
 */
import { institutionKey } from "@/lib/institutionGroups";
import type { InstitutionCatalogItem } from "@/types/finnos";

export const INSTITUTION_CATALOG: InstitutionCatalogItem[] = [
  { id: "nubank", name: "Nubank", color: "#820AD1", kind: "banco" },
  { id: "itau", name: "Itaú", color: "#EC7000", kind: "banco" },
  { id: "bradesco", name: "Bradesco", color: "#CC092F", kind: "banco" },
  { id: "inter", name: "Inter", color: "#FF7A00", kind: "banco" },
  { id: "santander", name: "Santander", color: "#EC0000", kind: "banco" },
  { id: "bb", name: "Banco do Brasil", color: "#0038A8", kind: "banco" },
  { id: "caixa", name: "Caixa", color: "#005CA9", kind: "banco" },
  { id: "c6", name: "C6 Bank", color: "#242424", kind: "banco" },
  { id: "mercadopago", name: "Mercado Pago", color: "#009EE3", kind: "banco" },
  { id: "picpay", name: "PicPay", color: "#11C76F", kind: "banco" },
  { id: "pagbank", name: "PagBank", color: "#00A868", kind: "banco" },
  { id: "btg", name: "BTG Pactual", color: "#0A2240", kind: "banco" },
  { id: "xp", name: "XP", color: "#1C1C1C", kind: "banco" },
  { id: "sicredi", name: "Sicredi", color: "#3FA110", kind: "banco" },
  { id: "sicoob", name: "Sicoob", color: "#003641", kind: "banco" },
  { id: "neon", name: "Neon", color: "#0098DA", kind: "banco" },
  { id: "alelo", name: "Alelo", color: "#00A86B", kind: "beneficio" },
  { id: "pluxee", name: "Pluxee", color: "#0F4C81", kind: "beneficio" },
  { id: "ticket", name: "Ticket", color: "#E4002B", kind: "beneficio" },
  { id: "vr", name: "VR", color: "#00A651", kind: "beneficio" },
  { id: "caju", name: "Caju", color: "#FF5A5F", kind: "beneficio" },
  { id: "flash", name: "Flash", color: "#FF2E63", kind: "beneficio" },
];

const FALLBACK_COLORS = ["#4B2CFF", "#0EA5E9", "#14B8A6", "#8C5BFF", "#F59E0B", "#EC4899", "#64748B", "#070F52"];

/** Name, color, kind and catalog id a new institution is stored with (mirror of the server). */
export function fallbackColor(name: string): string {
  const key = institutionKey(name);
  let sum = 0;
  for (const ch of key) sum += ch.codePointAt(0) ?? 0;
  return FALLBACK_COLORS[sum % FALLBACK_COLORS.length];
}

export function institutionIdentity(name: string, catalogId?: string | null) {
  const item = INSTITUTION_CATALOG.find((x) => x.id === catalogId) ?? INSTITUTION_CATALOG.find((x) => institutionKey(x.name) === institutionKey(name));
  if (item) return { name: item.name, color: item.color, kind: item.kind, catalog_id: item.id };
  const clean = name.trim().replace(/\s+/g, " ");
  return { name: clean, color: fallbackColor(clean), kind: "outro" as const, catalog_id: null };
}
