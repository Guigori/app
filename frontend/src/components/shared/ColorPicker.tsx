import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const PRESETS = ["#F59E0B", "#84CC16", "#22C55E", "#10B981", "#14B8A6", "#06B6D4", "#0EA5E9", "#3B82F6", "#6366F1", "#8B5CF6", "#A855F7", "#D946EF", "#EC4899", "#F43F5E", "#EF4444", "#F97316", "#EAB308", "#A16207", "#64748B", "#070F52"];

const hslToHex = (h: number, s: number, l: number) => {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
};
const hexToHsl = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return [262, 80, 60];
  const n = parseInt(m[1], 16); const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b); const l = (max + min) / 2; let h = 0, s = 0;
  if (max !== min) { const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min); h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
};

/** Preset colours plus any colour: a hue bar, a light/dark bar and the hex code. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hsl, setHsl] = useState(() => hexToHsl(value));
  const [hex, setHex] = useState(value.toUpperCase());
  useEffect(() => { setHex(value.toUpperCase()); setHsl(hexToHsl(value)); }, [value]);
  const set = (h: number, l: number) => { const s = Math.max(hsl[1], 55); const next = hslToHex(h, s, l); setHsl([h, s, l]); onChange(next); };
  const [h, s, l] = hsl;
  return (
    <div className="space-y-3" data-testid="category-color-picker">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((c) => (
          <button key={c} type="button" onClick={() => onChange(c)} aria-label={`Selecionar cor ${c}`} aria-pressed={value.toUpperCase() === c}
            className={cn("size-8 rounded-full border-2 transition-transform", value.toUpperCase() === c ? "scale-110 border-foreground" : "border-transparent hover:scale-105")} style={{ backgroundColor: c }} data-testid="category-color-swatch" />
        ))}
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted/40 p-3">
        <span className="size-12 shrink-0 rounded-full border border-border" style={{ backgroundColor: value }} aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <input type="range" min={0} max={359} value={h} onChange={(e) => set(Number(e.target.value), l)} aria-label="Tom da cor"
            className="color-range h-3 w-full appearance-none rounded-full" style={{ background: "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" }} />
          <input type="range" min={20} max={80} value={l} onChange={(e) => set(h, Number(e.target.value))} aria-label="Claro ou escuro"
            className="color-range h-3 w-full appearance-none rounded-full" style={{ background: `linear-gradient(to right,${hslToHex(h, s || 70, 20)},${hslToHex(h, s || 70, 50)},${hslToHex(h, s || 70, 80)})` }} />
        </div>
        <input value={hex} maxLength={7} aria-label="Código da cor" onChange={(e) => { const v = e.target.value.toUpperCase(); setHex(v); if (/^#[0-9A-F]{6}$/.test(v)) onChange(v); }}
          className="h-9 w-[5.5rem] shrink-0 rounded-full bg-background px-3 text-center font-mono text-xs uppercase outline-none" />
      </div>
    </div>
  );
}
