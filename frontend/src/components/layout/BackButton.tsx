import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, X } from "lucide-react";
import { canGoBack } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Padrão FINNOS de cabeçalho: o botão de voltar (ou fechar) fica sempre à esquerda, o título da tela ao lado dele e
 * os ícones de ação à direita, na mesma linha, logo abaixo da barra do topo.
 */

/** Section roots and their tabs have no back control. Nested screens return to their parent section. */
export function useBack() {
  const navigate = useNavigate();
  const location = useLocation();
  const segments = location.pathname.split("/").filter(Boolean);
  const show = segments.length >= 2 && !(segments[0] === "radar" && segments.length === 2) && location.pathname !== "/configuracoes";
  const parentPath = `/${segments.slice(0, -1).join("/")}`;
  const fromNotifications = Boolean((location.state as { fromNotifications?: boolean } | null)?.fromNotifications);
  return {
    show,
    go: () => (fromNotifications || canGoBack() ? navigate(-1) : navigate(parentPath)),
    label: fromNotifications ? "Voltar para a central de notificações" : "Voltar para a seção anterior",
  };
}

/** The round control used everywhere: an arrow to go back, an X to close. */
/** `custom` draws the given icon (an action on the right of a header) with the same round shape. */
export function HeaderIconButton({ onClick, label, kind = "back", className, testId, children }: { onClick: () => void; label: string; kind?: "back" | "close" | "custom"; className?: string; testId?: string; children?: ReactNode }) {
  const Icon = kind === "close" ? X : ArrowLeft;
  return (
    <button type="button" onClick={onClick} aria-label={label} title={kind === "close" ? "Fechar" : kind === "back" ? "Voltar" : label} data-testid={testId}
      className={cn("grid size-10 shrink-0 place-items-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-muted", className)}>
      {kind === "custom" ? children : <Icon className="h-5 w-5" aria-hidden="true" />}
    </button>
  );
}

/** Screens with a ScreenHeader tell the shell, so it does not draw a second back button above them. */
// A count, not a flag: during the page transition the next screen mounts before the previous one leaves.
const HeaderSlot = createContext<((delta: number) => void) | null>(null);
export function HeaderSlotProvider({ children, onChange }: { children: ReactNode; onChange: (delta: number) => void }) {
  return <HeaderSlot.Provider value={onChange}>{children}</HeaderSlot.Provider>;
}
export function useHeaderSlotState() {
  const [count, setCount] = useState(0);
  // Stable, so screens registering do not re-run on every shell render.
  const change = useCallback((delta: number) => setCount((c) => Math.max(0, c + delta)), []);
  return [count > 0, change] as const;
}

/** For a screen that draws its own header with its own back control (Carteira bank screen). */
export function useOwnHeader() {
  const register = useContext(HeaderSlot);
  useEffect(() => { register?.(1); return () => register?.(-1); }, [register]);
}

/** The header of a screen: [voltar] título / subtítulo … [ações]. */
export function ScreenHeader({ title, subtitle, eyebrow, actions, onBack, backLabel, back, className, titleTestId, keepSubtitle }: {
  title: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode;
  /** A screen's own way back (e.g. a filtered Fluxo returning where it came from). */
  onBack?: () => void; backLabel?: string;
  /** Force the back control on (true) or off (false); by default it follows the route. */
  back?: boolean; className?: string; titleTestId?: string;
  /** The subtitle carries data (a date, a cycle): keep it on phones, where descriptive subtitles are hidden. */
  keepSubtitle?: boolean;
}) {
  const nav = useBack();
  const register = useContext(HeaderSlot);
  useEffect(() => { register?.(1); return () => register?.(-1); }, [register]);
  const showBack = back ?? (Boolean(onBack) || nav.show);
  return (
    <header className={cn("-mt-1 flex items-center gap-3", className)} data-testid="screen-header">
      {showBack ? <HeaderIconButton onClick={onBack ?? nav.go} label={backLabel ?? nav.label} testId="back-button" /> : null}
      <div className="min-w-0 flex-1">
        {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{eyebrow}</p> : null}
        <h1 className="line-clamp-2 font-heading text-[22px] font-bold leading-tight tracking-tight text-foreground sm:text-2xl" data-testid={titleTestId}>{title}</h1>
        {subtitle ? <p data-keep={keepSubtitle ? "" : undefined} className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  );
}

/** Fallback for screens that do not use ScreenHeader yet: the arrow alone, at the left. */
export function BackButton() {
  const nav = useBack();
  if (!nav.show) return null;
  return <HeaderIconButton onClick={nav.go} label={nav.label} className="mb-3" testId="back-button" />;
}
