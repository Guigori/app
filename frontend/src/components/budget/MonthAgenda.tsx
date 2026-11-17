/** O mês num calendário: o que entra, o que sai e os lembretes de cada dia. Tocar num dia mostra a lista dele. */
import { useState } from "react";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AgendaItem { date: string; name: string; value?: number; kind: "entra" | "sai" | "lembrete" }

const WD = ["D", "S", "T", "Q", "Q", "S", "S"];

export function MonthAgenda({ month, items, money }: { month: string; items: AgendaItem[]; money: (v: number) => string }) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1).getDay(), days = new Date(y, m, 0).getDate();
  const by = new Map<number, AgendaItem[]>();
  for (const it of items) if (it.date.slice(0, 7) === month) { const d = Number(it.date.slice(8)); by.set(d, [...(by.get(d) ?? []), it]); }
  const firstDay = [...by.keys()].sort((a, b) => a - b)[0] ?? null;
  const [sel, setSel] = useState<number | null>(firstDay);
  const list = sel ? by.get(sel) ?? [] : [];
  return (
    <div data-testid="month-agenda">
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">{WD.map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: first }).map((_, i) => <span key={`e${i}`} />)}
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
          const its = by.get(d) ?? [];
          const has = (k: AgendaItem["kind"]) => its.some((x) => x.kind === k);
          return (
            <button key={d} type="button" onClick={() => setSel(d)} aria-pressed={sel === d} aria-label={`Dia ${d}: ${its.map((x) => x.name).join(", ") || "nada"}`}
              className={cn("flex aspect-square flex-col items-center justify-center rounded-xl text-[13px] font-medium", sel === d ? "bg-primary text-primary-foreground" : its.length ? "bg-primary/[0.07]" : "")}>
              {d}
              <span className="mt-0.5 flex h-1.5 gap-0.5">
                {has("entra") ? <span className="h-1.5 w-1.5 rounded-full bg-income" /> : null}
                {has("sai") ? <span className="h-1.5 w-1.5 rounded-full bg-expense" /> : null}
                {has("lembrete") ? <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-3 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-income" />entra</span><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-expense" />sai</span><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />lembrete</span></div>
      {sel ? (
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border text-[13px]">
          {list.length ? list.map((it, i) => (
            <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">{it.kind === "lembrete" ? <Bell className="h-3.5 w-3.5 shrink-0 text-amber-600" /> : null}<span className="truncate">{it.name}</span></span>
              {it.value != null ? <strong className={cn("tabular-nums", it.kind === "entra" ? "text-income" : "")}>{it.kind === "entra" ? "+ " : "− "}{money(it.value)}</strong> : null}
            </li>
          )) : <li className="px-3 py-2 text-muted-foreground">Nada marcado no dia {sel}.</li>}
        </ul>
      ) : null}
    </div>
  );
}
