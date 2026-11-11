/**
 * A screen that fails to draw shows a way out instead of a blank page. A failed page download
 * (usually a new version published while the app was open) reloads the app once, by itself.
 */
import { Component, type ReactNode } from "react";
import { isChunkError, reloadOnce } from "@/lib/lazyRetry";

interface Props { children: ReactNode; /** Changing it (the route) clears the error. */ resetKey?: string; compact?: boolean }
interface State { error: Error | null; key?: string }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): Partial<State> { return { error }; }
  /** Another screen clears the error of the last one. */
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  componentDidCatch(error: Error) {
    console.error("[FINNOS] tela com erro", error);
    if (isChunkError(error)) reloadOnce();
  }
  render() {
    if (!this.state.error) return this.props.children;
    const chunk = isChunkError(this.state.error);
    return (
      <div role="alert" data-testid="app-error" className={this.props.compact ? "mx-auto max-w-md px-4 py-16 text-center" : "flex min-h-dvh flex-col items-center justify-center bg-background px-6 text-center text-foreground"}>
        <p className="text-lg font-semibold">{chunk ? "Há uma versão nova do FINNOS" : "Não deu para abrir esta tela"}</p>
        <p className="mt-2 text-sm text-muted-foreground">{chunk ? "Recarregue para usar a versão mais recente." : "Seus dados estão seguros. Tente de novo ou volte para o Início."}</p>
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" onClick={() => window.location.reload()} className="h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">Recarregar</button>
          {!chunk ? <button type="button" onClick={() => { this.setState({ error: null }); window.location.assign("/"); }} className="h-11 rounded-full border border-border bg-card px-5 text-sm font-semibold">Ir para o Início</button> : null}
        </div>
      </div>
    );
  }
}
