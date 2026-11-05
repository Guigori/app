import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ShieldCheck, X } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { motion } from "motion/react";
import { fetchRadar, updateRadarSignal } from "@/lib/data";
import { useRouteState } from "@/lib/routeState";
import { RADAR_COLOR, RADAR_ICON, RADAR_LABEL, RADAR_PLURAL, RADAR_TYPES, needsAttention, radarTarget, severityLabel, sortSignals } from "@/lib/radarUi";
import { cn } from "@/lib/utils";
import type { RadarSignal, RadarSignalType } from "@/types/finnos";

const CHECKS = ["Faturas perto do vencimento", "Orçamentos perto do limite", "Gastos fora do seu padrão", "Cobranças duplicadas", "Mês mais caro que o anterior", "Gastos que se repetem todo mês"];

function SignalCard({ signal, onDismiss }: { signal: RadarSignal; onDismiss: () => void }) {
  const Icon = RADAR_ICON[signal.type];
  const color = RADAR_COLOR[signal.type];
  const severity = severityLabel(signal);
  const target = radarTarget(signal);
  return (
    <article className="relative rounded-2xl border border-border bg-card transition-colors hover:border-foreground/20" data-testid={`radar-signal-${signal.id}`}>
      <Link to={`/radar/${signal.id}`} className="flex items-start gap-3 p-4 pb-2" aria-label={`${RADAR_LABEL[signal.type]}: ${signal.title}`}>
        <span className="grid size-10 shrink-0 place-items-center rounded-full" style={{ backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`, color }}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-semibold" style={{ color }}>{RADAR_LABEL[signal.type]}</span>
            {severity ? <span className="rounded-full px-1.5 py-px font-semibold" style={{ backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`, color }}>{severity}</span> : null}
            {signal.state === "new" ? <span className="flex items-center gap-1 text-muted-foreground"><span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />novo</span> : null}
            {signal.metric ? <span className="ml-auto pl-2 font-heading text-sm font-bold tabular-nums text-foreground">{signal.metric}</span> : null}
          </span>
          <span className="mt-1 block font-semibold leading-snug text-foreground">{signal.title}</span>
          <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{signal.description}</span>
        </span>
      </Link>
      <div className="flex items-center gap-1 px-4 pb-3 pl-[68px]">
        <Link to={target.to} className="inline-flex h-8 items-center gap-1 rounded-full bg-muted px-3 text-xs font-semibold text-foreground hover:bg-muted/70">
          {target.label}<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
        <button type="button" onClick={onDismiss} className="ml-auto inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Dispensar ${signal.title}`}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />Dispensar
        </button>
      </div>
    </article>
  );
}

export default function Radar() {
  const queryClient = useQueryClient();
  const [chosen, setFilter] = useRouteState<RadarSignalType | "todos">("radar:filter", () => "todos");
  const { data, isPending, isError, refetch } = useQuery({ queryKey: ["radar"], queryFn: fetchRadar, staleTime: 60_000 });
  const items = sortSignals(data?.items ?? []);
  const counts = Object.fromEntries(RADAR_TYPES.map((type) => [type, items.filter((s) => s.type === type).length])) as Record<RadarSignalType, number>;
  // A filter whose last signal was dismissed falls back to everything.
  const filter = chosen !== "todos" && !counts[chosen] ? "todos" : chosen;
  const urgent = items.filter(needsAttention);
  const visible = filter === "todos" ? items : items.filter((s) => s.type === filter);
  const dismiss = useMutation({
    mutationFn: (signal: RadarSignal) => updateRadarSignal(signal.id, "dismiss"),
    onSuccess: async (_r, signal) => {
      toast.success("Sinal dispensado.", { description: signal.title });
      await queryClient.invalidateQueries({ queryKey: ["radar"] });
    },
    onError: () => toast.error("Não foi possível dispensar este sinal."),
  });

  const list = (rows: RadarSignal[]) => (
    <div className="space-y-2.5">
      {rows.map((signal, index) => (
        <motion.div key={signal.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 6) * 0.04, duration: 0.25 }}>
          <SignalCard signal={signal} onDismiss={() => dismiss.mutate(signal)} />
        </motion.div>
      ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5 animate-fade-up">
      <div>
        <h1 className="font-heading text-2xl font-bold">Radar</h1>
        <p className="mt-1 text-sm text-muted-foreground">O que merece sua atenção no seu dinheiro agora.</p>
      </div>

      {isPending ? <div className="space-y-2.5" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />)}</div> : null}
      {isError ? (
        <div role="alert" className="rounded-2xl border border-destructive/30 bg-card p-5 text-sm text-destructive">
          Não foi possível atualizar seu Radar. Os sinais não foram conferidos nesta consulta.{" "}
          <button type="button" onClick={() => void refetch()} className="font-semibold underline">Tentar novamente</button>
        </div>
      ) : null}

      {!isPending && !isError && items.length === 0 ? (
        <section className="rounded-3xl border border-border bg-card p-6 text-center sm:p-8" data-testid="radar-empty">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-income/10 text-income"><ShieldCheck className="h-7 w-7" aria-hidden="true" /></span>
          <h2 className="mt-4 font-heading text-xl font-bold">Tudo tranquilo por aqui</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Nenhum sinal agora. O FINNOS confere seus dados sempre que você abre o app:</p>
          <ul className="mx-auto mt-4 grid max-w-md gap-1.5 text-left text-sm sm:grid-cols-2">
            {CHECKS.map((check) => <li key={check} className="flex items-center gap-2 text-muted-foreground"><span className="size-1.5 shrink-0 rounded-full bg-income" aria-hidden="true" />{check}</li>)}
          </ul>
        </section>
      ) : null}

      {!isPending && !isError && items.length > 0 ? (
        <>
          <section className="rounded-[24px] border border-border bg-card p-5" data-testid="radar-summary">
            <p className="text-sm text-muted-foreground">{items.length} {items.length === 1 ? "sinal ativo" : "sinais ativos"}</p>
            <p className="mt-1 font-heading text-2xl font-bold">
              {urgent.length === 0 ? "Nada urgente agora" : `${urgent.length} ${urgent.length === 1 ? "pede" : "pedem"} sua atenção`}
            </p>
            <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={RADAR_TYPES.filter((t) => counts[t]).map((t) => `${counts[t]} ${RADAR_PLURAL[t].toLowerCase()}`).join(", ")}>
              {RADAR_TYPES.filter((t) => counts[t]).map((type) => <span key={type} className="h-full first:rounded-l-full last:rounded-r-full" style={{ flexGrow: counts[type], backgroundColor: RADAR_COLOR[type] }} />)}
            </div>
          </section>

          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0" role="tablist" aria-label="Filtrar sinais">
            {(["todos", ...RADAR_TYPES.filter((t) => counts[t])] as const).map((key) => (
              <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)} data-testid={`radar-filter-${key}`}
                className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors", filter === key ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
                {key !== "todos" ? <span className="size-2 rounded-full" style={{ backgroundColor: RADAR_COLOR[key] }} aria-hidden="true" /> : null}
                {key === "todos" ? "Todos" : RADAR_PLURAL[key]}
                <span className="tabular-nums opacity-70">{key === "todos" ? items.length : counts[key]}</span>
              </button>
            ))}
          </div>

          {filter === "todos" && urgent.length > 0 && urgent.length < items.length ? (
            <>
              <section aria-labelledby="radar-now"><h2 id="radar-now" className="mb-2 px-1 text-sm font-semibold text-muted-foreground">Agora</h2>{list(urgent)}</section>
              <section aria-labelledby="radar-later"><h2 id="radar-later" className="mb-2 px-1 text-sm font-semibold text-muted-foreground">Para acompanhar</h2>{list(items.filter((s) => !needsAttention(s)))}</section>
            </>
          ) : list(visible)}

          <p className="text-xs text-muted-foreground">Os sinais são recalculados a partir dos seus lançamentos, cartões e orçamentos. O que você dispensa não volta, a menos que a situação mude.</p>
        </>
      ) : null}
    </div>
  );
}
