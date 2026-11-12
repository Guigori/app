import type { CardInput, CreditCard } from "@/types/finnos";

export const sectionTitle = "mx-1 mb-2.5 mt-6 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground";

export const cardInput = (c: CreditCard, patch: Partial<CardInput> = {}): CardInput => ({
  name: c.name, institution: c.institution, institution_id: c.institution_id ?? null, color: c.color, limit: c.limit,
  closing_day: c.closing_day, due_day: c.due_day, payment_account_id: c.payment_account_id ?? null, active: c.active, ...patch,
});
