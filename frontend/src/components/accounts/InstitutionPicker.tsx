/**
 * Choose the bank (or benefit provider) an account or card belongs to: the
 * owner's institutions first, then the catalog, then a typed name. The color
 * always comes from the institution, so there is no color to pick.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Plus } from "lucide-react";
import type { Institution, InstitutionKind } from "@/types/finnos";
import { catalogChoice, type InstitutionChoice } from "@/lib/institutionSelection";
import { fetchInstitutionCatalog } from "@/lib/data";
import { institutionKey } from "@/lib/institutionGroups";
import { fallbackColor } from "@/lib/institutionCatalog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const initials = (name: string) => {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
};

interface Option { choice: InstitutionChoice; name: string; color: string }

export function InstitutionPicker({
  institutions, choice, name, onChoice, onName, label = "Instituição", kind = "banco", allowNone = false,
}: {
  institutions: Institution[];
  choice: InstitutionChoice;
  name: string;
  onChoice: (value: InstitutionChoice) => void;
  onName: (value: string) => void;
  label?: string;
  /** Banks for accounts and cards, providers for benefits. */
  kind?: Exclude<InstitutionKind, "outro">;
  /** Older entries without institution can stay so while editing. */
  allowNone?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const catalogQuery = useQuery({ queryKey: ["institution-catalog"], queryFn: fetchInstitutionCatalog, staleTime: Infinity });
  const registeredKeys = new Set(institutions.map((i) => institutionKey(i.name)));
  const mine: Option[] = institutions
    .filter((i) => (i.kind ?? "outro") === kind || i.kind === "outro" || !i.kind)
    .map((i) => ({ choice: i.id, name: i.name, color: i.color }));
  const catalog: Option[] = (catalogQuery.data ?? [])
    .filter((item) => item.kind === kind && !registeredKeys.has(institutionKey(item.name)))
    .map((item) => ({ choice: catalogChoice(item.id), name: item.name, color: item.color }));
  const tile = (option: Option) => {
    const on = choice === option.choice;
    return (
      <button key={option.choice} type="button" onClick={() => onChoice(option.choice)} aria-pressed={on}
        className={cn("relative flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-2xl border bg-card px-1 py-2 text-center transition",
          on ? "border-primary ring-2 ring-primary/30" : "border-border hover:bg-muted")}
        data-testid="institution-option">
        <span className="grid size-9 place-items-center rounded-xl font-heading text-[13px] font-bold text-white" style={{ backgroundColor: option.color }} aria-hidden="true">{initials(option.name)}</span>
        <span className="line-clamp-2 text-[12px] font-semibold leading-tight">{option.name}</span>
        {on ? <Check className="absolute right-1.5 top-1.5 size-3.5 text-primary" aria-hidden="true" /> : null}
      </button>
    );
  };
  // The most common first; the rest one tap away (or open when the choice is among them).
  const FIRST = 7;
  const showAll = expanded || catalog.slice(FIRST).some((o) => o.choice === choice);
  const visible = showAll ? catalog : catalog.slice(0, FIRST);
  const typedColor = name.trim().length >= 2 ? fallbackColor(name) : "#C9C3FF";
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      {mine.length ? <p className="text-xs text-muted-foreground">Suas instituições</p> : null}
      {mine.length ? <div className="grid grid-cols-4 gap-2">{mine.map(tile)}</div> : null}
      <p className="text-xs text-muted-foreground">{kind === "beneficio" ? "Empresas de benefício" : "Bancos"}</p>
      <div className="grid grid-cols-4 gap-2" data-testid="institution-catalog">
        {visible.map(tile)}
        {!showAll && catalog.length > FIRST ? (
          <button type="button" onClick={() => setExpanded(true)} className="flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-border px-1 py-2 text-[12px] font-semibold text-muted-foreground hover:bg-muted">
            <ChevronDown className="size-5" aria-hidden="true" />Mais {catalog.length - FIRST}
          </button>
        ) : null}
        <button type="button" onClick={() => onChoice("new")} aria-pressed={choice === "new"}
          className={cn("flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed px-1 py-2 text-[12px] font-semibold text-primary",
            choice === "new" ? "border-primary ring-2 ring-primary/30" : "border-primary/40")}>
          <Plus className="size-5" aria-hidden="true" />Outro
        </button>
        {allowNone ? (
          <button type="button" onClick={() => onChoice("none")} aria-pressed={choice === "none"}
            className={cn("flex min-h-[84px] items-center justify-center rounded-2xl border px-1 text-[12px] font-semibold text-muted-foreground",
              choice === "none" ? "border-primary ring-2 ring-primary/30" : "border-border")}>Sem instituição</button>
        ) : null}
      </div>
      {choice === "new" && (
        <div className="space-y-2 pt-1">
          <Label htmlFor="wallet-institution-name">Nome {kind === "beneficio" ? "da empresa do benefício" : "do banco"}</Label>
          <div className="flex items-center gap-2">
            <span className="size-9 shrink-0 rounded-xl" style={{ backgroundColor: typedColor }} aria-hidden="true" />
            <Input id="wallet-institution-name" value={name} maxLength={60} onChange={e => onName(e.target.value)}
              placeholder={kind === "beneficio" ? "Ex.: Swile, Ben" : "Ex.: Banco Original"} />
          </div>
          <p className="text-xs text-muted-foreground">A cor é escolhida pelo FINNOS a partir do nome. Nomes diferentes não são juntados automaticamente.</p>
        </div>
      )}
    </fieldset>
  );
}
