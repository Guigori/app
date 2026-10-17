import type { Institution } from "@/types/finnos";
import { createInstitution, fetchInstitutions } from "@/lib/data";
import { institutionKey } from "@/lib/institutionGroups";

export type InstitutionChoice = "new" | "none" | string;

/** Resolves an explicit issuer choice; no automatic equivalence between bank aliases. */
export async function resolveInstitutionChoice(
  choice: InstitutionChoice, typedName: string, registered: Institution[],
): Promise<{ institution: string; institution_id: string | null }> {
  if (choice === "none") return { institution: "", institution_id: null };
  if (choice !== "new") {
    const selected = registered.find(item => item.id === choice);
    if (!selected) throw new Error("Instituição selecionada não está disponível. Atualize a lista.");
    return { institution: selected.name, institution_id: selected.id };
  }
  const name = typedName.trim().replace(/\s+/g, " ");
  if (!name) return { institution: "", institution_id: null };
  const existing = registered.find(item => institutionKey(item.name) === institutionKey(name));
  if (existing) return { institution: existing.name, institution_id: existing.id };
  try {
    const institution = await createInstitution({ name, color: "#5B35FF" });
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
