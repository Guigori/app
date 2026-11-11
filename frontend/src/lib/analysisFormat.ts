import { useBalanceHidden } from "@/lib/balance";

/** Formatting and chart styling shared by the Análise screens. */
export const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const brlShort = (v: number) =>
  Math.abs(v) >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
export const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** Recessive grid/axes and a tooltip in theme tokens (never series colours for text). */
export const axisTick = { fontSize: 12, fill: "var(--muted-foreground)" };
export const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--popover-foreground)", fontSize: 13 };
/** Tooltip text always readable on the popover (bars coloured per cell have no series colour to borrow). */
export const tooltipItemStyle = { color: "var(--popover-foreground)" };
export const tooltipLabelStyle = { color: "var(--muted-foreground)", marginBottom: 2 };

export function useMoney() {
  const { hidden } = useBalanceHidden();
  return { hidden, money: (v: number) => (hidden ? "••••" : brl(v)), short: (v: number) => (hidden ? "••" : brlShort(v)) };
}


/** Axis ticks: the unit is in the title, so "8 mil" / "500" keeps the axis narrow. */
export const axisMoney = (v: number) =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : Math.round(v).toLocaleString("pt-BR");
