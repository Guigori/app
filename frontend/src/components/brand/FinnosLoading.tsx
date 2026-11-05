import { cn } from "@/lib/utils";
import { FinnosIcon } from "@/components/brand/FinnosLogo";

type FinnosLoadingProps = {
  title?: string;
  description?: string;
  fullscreen?: boolean;
  className?: string;
};

/** App-level loading: theme colours and a soft brand pulse instead of a black
 * video box, so a first paint never looks broken (light or dark). */
export function FinnosLoading({
  title = "Carregando seus dados",
  description = "Estamos preparando sua visão financeira.",
  fullscreen = false,
  className,
}: FinnosLoadingProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 bg-background text-center",
        fullscreen ? "min-h-svh px-6" : "min-h-64 px-6 py-12",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <FinnosIcon className="h-12 w-12 motion-safe:animate-pulse" />
      <div className="space-y-1">
        <p className="font-heading text-sm font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function Bar({ className }: { className?: string }) {
  return <div className={cn("rounded-lg bg-muted motion-safe:animate-pulse", className)} aria-hidden="true" />;
}

/** Page-level loading: the outline of a FINNOS page (title, summary cards and
 * list rows) in theme colours, so content swaps in place without a jump. */
export function FinnosPageLoading({ title, description }: Pick<FinnosLoadingProps, "title" | "description">) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-5" data-testid="page-skeleton">
      <span className="sr-only">{title ?? "Carregando"}. {description}</span>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3 rounded-2xl border border-border bg-card p-5">
            <Bar className="h-3 w-24" />
            <Bar className="h-7 w-36" />
          </div>
        ))}
      </div>
      <div className="space-y-1 rounded-2xl border border-border bg-card p-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <Bar className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Bar className="h-3.5 w-1/3" />
              <Bar className="h-3 w-1/5" />
            </div>
            <Bar className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
