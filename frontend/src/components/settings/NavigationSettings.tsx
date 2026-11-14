import { useState } from "react";
import { ChevronDown, ChevronUp, Minus, Plus } from "lucide-react";
import { MAIN_NAV, MENU_SLUGS, NAV_GROUPS } from "@/components/layout/nav";
import { MOBILE_MAX, MOBILE_MIN, navItemsFor, resetNavigationPreferences, saveNavigationPreferences, useNavigationPreferences, type NavigationPreferences } from "@/lib/navigationPreferences";
import { cn } from "@/lib/utils";

const CAPTION = "px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground";
const CARD = "overflow-hidden rounded-2xl border border-border bg-card";
const ICON_BTN = "grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-card text-foreground disabled:opacity-30";

function Switch({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} data-testid={testId}
      className={cn("relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-border")}>
      <span className={cn("absolute top-[3px] size-6 rounded-full bg-white shadow transition-[left]", checked ? "left-[23px]" : "left-[3px]")} />
    </button>
  );
}

const move = (list: string[], i: number, d: number) => { const a = [...list]; [a[i], a[i + d]] = [a[i + d], a[i]]; return a; };

/** Barra e menu: each person chooses the bottom-bar tabs and what the menu shows, on the phone and on the computer. */
export function NavigationSettings() {
  const prefs = useNavigationPreferences();
  const [device, setDevice] = useState<"mobile" | "web">("mobile");
  const save = (patch: Partial<NavigationPreferences>) => saveNavigationPreferences({ ...prefs, ...patch });
  const label = (slug: string) => MAIN_NAV.find((i) => i.slug === slug)?.label ?? slug;
  const bar = navItemsFor(prefs.mobile);
  const full = prefs.mobile.length >= MOBILE_MAX;
  const available = MAIN_NAV.filter((i) => !prefs.mobile.includes(i.slug));
  const hiddenKey = device === "mobile" ? "menuHiddenMobile" : "menuHiddenWeb";
  const hidden = prefs[hiddenKey];
  const menuOrder = device === "mobile" ? MENU_SLUGS : prefs.webOrder;

  return (
    <div className="space-y-5" data-testid="settings-navigation-card">
      <div role="tablist" aria-label="Aparelho" className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
        {(["mobile", "web"] as const).map((d) => (
          <button key={d} type="button" role="tab" aria-selected={device === d} onClick={() => setDevice(d)} data-testid={`settings-nav-${d}`}
            className={cn("h-10 rounded-full text-sm font-semibold", device === d ? "bg-card text-primary shadow-sm dark:text-[#B3A6FF]" : "text-muted-foreground")}>
            {d === "mobile" ? "Celular" : "Computador"}
          </button>
        ))}
      </div>

      {device === "mobile" ? (
        <>
          <div className="rounded-3xl border border-border bg-muted/40 px-3 py-5" aria-label="Prévia da barra de baixo" data-testid="settings-mobile-dock-preview">
            <div className="flex items-center gap-2">
              <div className="grid min-w-0 flex-1 items-center rounded-full border border-white/50 bg-[#eeeeee]/80 p-[3px] dark:border-white/15 dark:bg-[#161625]/80"
                style={{ gridTemplateColumns: bar.map((_, i) => (i === 0 ? "2.3fr" : "1fr")).join(" ") }}>
                {bar.map((item, i) => (
                  <div key={item.slug} className={cn("flex h-14 min-w-0 items-center justify-center gap-1.5 rounded-full px-1", i === 0 ? "bg-white text-primary dark:bg-white/10 dark:text-[#A996FF]" : "text-[#45465F] dark:text-white/80")}>
                    <item.icon className="size-5 shrink-0" aria-hidden="true" />{i === 0 ? <span className="truncate text-[13px] font-semibold">{item.label}</span> : null}
                  </div>
                ))}
              </div>
              {prefs.fab ? <span className="grid size-14 shrink-0 place-items-center rounded-full bg-[#8B5CF6] text-white" aria-hidden="true"><Plus className="size-6" /></span> : null}
            </div>
            <p className="mt-2.5 text-center text-xs text-muted-foreground">Prévia da barra de baixo</p>
          </div>

          <section className="space-y-2" aria-label="Barra de baixo">
            <h2 className={CAPTION}>Barra de baixo</h2>
            <p className="px-1 text-xs text-muted-foreground">De {MOBILE_MIN} a {MOBILE_MAX} abas. Início fica sempre na primeira posição.</p>
            <div className={CARD}>
              {bar.map((item, i) => (
                <div key={item.slug} className="flex min-h-14 items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary dark:text-[#B3A6FF]"><item.icon className="size-[1.1rem]" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{item.label}</span><span className="block text-xs text-muted-foreground">{i === 0 ? "Fixa na primeira posição" : `${i + 1}ª aba`}</span></span>
                  {i > 0 ? (
                    <>
                      <button type="button" className={ICON_BTN} disabled={i <= 1} onClick={() => save({ mobile: move(prefs.mobile, i, -1) })} aria-label={`Subir ${item.label}`}><ChevronUp className="size-4" /></button>
                      <button type="button" className={ICON_BTN} disabled={i >= bar.length - 1} onClick={() => save({ mobile: move(prefs.mobile, i, 1) })} aria-label={`Descer ${item.label}`}><ChevronDown className="size-4" /></button>
                      <button type="button" className={cn(ICON_BTN, "text-[#BE123C]")} disabled={bar.length <= MOBILE_MIN} onClick={() => save({ mobile: prefs.mobile.filter((s) => s !== item.slug) })} aria-label={`Tirar ${item.label} da barra`} data-testid={`settings-bar-remove-${item.slug}`}><Minus className="size-4" /></button>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="px-1 pt-1 text-[13px] font-semibold text-muted-foreground">{full ? "A barra está cheia. Tire uma aba para pôr outra." : "Toque para pôr na barra"}</p>
            <div className="flex flex-wrap gap-2">
              {available.map((item) => (
                <button key={item.slug} type="button" disabled={full} onClick={() => save({ mobile: [...prefs.mobile, item.slug] })} aria-label={`Pôr ${item.label} na barra`} data-testid={`settings-bar-add-${item.slug}`}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-3 text-[13px] font-semibold disabled:opacity-45">
                  <item.icon className="size-4" aria-hidden="true" />{item.label}<Plus className="size-3.5" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        </>
      ) : null}

      <section className="space-y-2" aria-label="Menu">
        <h2 className={CAPTION}>{device === "mobile" ? "Menu" : "Menu lateral"}</h2>
        <p className="px-1 text-xs text-muted-foreground">{device === "mobile" ? "O que aparece no menu que abre pelo ☰ ou arrastando da borda." : "O que aparece no menu do computador, e em que ordem dentro de cada seção."}</p>
        <div className={CARD}>
          {NAV_GROUPS.flatMap((group) => [...group.items].sort((a, b) => menuOrder.indexOf(a) - menuOrder.indexOf(b))).map((slug) => {
            const item = MAIN_NAV.find((i) => i.slug === slug)!;
            const inBar = device === "mobile" && prefs.menuDedupe && prefs.mobile.includes(slug);
            const on = !inBar && !hidden.includes(slug);
            const group = NAV_GROUPS.find((g) => g.items.includes(slug))!;
            const siblings = [...group.items].sort((a, b) => menuOrder.indexOf(a) - menuOrder.indexOf(b));
            const pos = siblings.indexOf(slug);
            return (
              <div key={slug} className={cn("flex min-h-14 items-center gap-3 border-b border-border px-3 py-2 last:border-b-0", inBar && "opacity-60")}>
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary dark:text-[#B3A6FF]"><item.icon className="size-[1.1rem]" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{inBar ? "Já está na barra de baixo" : `${group.label ?? "Principal"} · ${on ? "aparece no menu" : "escondido"}`}</span>
                </span>
                {device === "web" ? (
                  <button type="button" className={ICON_BTN} disabled={pos <= 0}
                    onClick={() => { const a = [...prefs.webOrder]; const i = a.indexOf(slug), j = a.indexOf(siblings[pos - 1]); [a[i], a[j]] = [a[j], a[i]]; save({ webOrder: a }); }}
                    aria-label={`Subir ${item.label}`}><ChevronUp className="size-4" /></button>
                ) : null}
                <Switch checked={on} label={`Mostrar ${label(slug)} no menu`} testId={`settings-menu-${device}-${slug}`}
                  onChange={(v) => { if (!inBar) save({ [hiddenKey]: v ? hidden.filter((s) => s !== slug) : [...hidden, slug] }); }} />
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2" aria-label="Mais opções">
        <h2 className={CAPTION}>Mais opções</h2>
        <div className={CARD}>
          {(device === "mobile"
            ? [
              { key: "menuDedupe" as const, label: "Não repetir no menu o que está na barra", note: "Deixa o menu mais curto" },
              { key: "fab" as const, label: "Botão + de novo registro", note: "Ao lado da barra de baixo" },
              { key: "aiMobile" as const, label: "Botão Conversa", note: "No topo da tela e no menu" },
              { key: "menuBadges" as const, label: "Avisos e valores no menu", note: "Ex.: 2 vencendo, R$ 89/mês" },
            ]
            : [
              { key: "menuBadges" as const, label: "Avisos e valores no menu", note: "Ex.: 2 vencendo, R$ 89/mês" },
              { key: "aiWeb" as const, label: "Botão Conversa", note: "No topo do menu" },
            ]).map((o) => (
            <div key={o.key} className="flex min-h-14 items-center gap-3 border-b border-border px-4 py-2 last:border-b-0">
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{o.label}</span><span className="block text-xs text-muted-foreground">{o.note}</span></span>
              <Switch checked={prefs[o.key]} label={o.label} onChange={(v) => save({ [o.key]: v })} testId={`settings-option-${o.key}`} />
            </div>
          ))}
        </div>
      </section>

      <button type="button" onClick={resetNavigationPreferences} className="h-12 w-full rounded-full border border-border bg-card text-sm font-bold hover:bg-muted" data-testid="settings-navigation-reset">
        Voltar ao padrão
      </button>
    </div>
  );
}
