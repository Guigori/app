import type { Institution } from "@/types/finnos";
import { createInstitution, fetchInstitutions } from "@/lib/data";
import { institutionKey } from "@/lib/institutionGroups";
import { INSTITUTION_CATALOG } from "@/lib/institutionCatalog";

/** A registered institution id, a catalog entry ("catalog:<id>"), a typed name ("new") or none. */
export type InstitutionChoice = "new" | "none" | string;

const CATALOG_PREFIX = "catalog:";
export const catalogChoice = (catalogId: string) => CATALOG_PREFIX + catalogId;
export const isCatalogChoice = (choice: InstitutionChoice) => choice.startsWith(CATALOG_PREFIX);

/** Resolves an explicit issuer choice; no automatic equivalence between bank aliases. */
export async function resolveInstitutionChoice(
  choice: InstitutionChoice, typedName: string, registered: Institution[],
): Promise<{ institution: string; institution_id: string | null }> {
  if (choice === "none") return { institution: "", institution_id: null };
  let name = typedName.trim().replace(/\s+/g, " ");
  let catalogId: string | null = null;
  if (isCatalogChoice(choice)) {
    catalogId = choice.slice(CATALOG_PREFIX.length);
    const item = INSTITUTION_CATALOG.find((x) => x.id === catalogId);
    if (!item) throw new Error("Instituição do catálogo não encontrada. Atualize a lista.");
    name = item.name;
  } else if (choice !== "new") {
    const selected = registered.find(item => item.id === choice);
    if (!selected) throw new Error("Instituição selecionada não está disponível. Atualize a lista.");
    return { institution: selected.name, institution_id: selected.id };
  }
  if (!name) return { institution: "", institution_id: null };
  const existing = registered.find(item => (catalogId && item.catalog_id === catalogId) || institutionKey(item.name) === institutionKey(name));
  if (existing) return { institution: existing.name, institution_id: existing.id };
  try {
    const institution = await createInstitution(catalogId ? { catalog_id: catalogId } : { name });
    return { institution: institution.name, institution_id: institution.id };
  } catch (error) {
    // A different device may have just created the same exact name.
    // Never assume an HTTP error means the write committed; query before retrying.
    const current = await fetchInstitutions().catch(() => []);
    const matched = current.find(item => institutionKey(item.name) === institutionKey(name));
    if (matched) return { institution: matched.name, institution_id: matched.id };
    throw error;
  }
}
