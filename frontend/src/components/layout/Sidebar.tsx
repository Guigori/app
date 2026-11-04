import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { LogOut, PanelLeftClose, PanelLeftOpen, Smartphone } from "lucide-react";
import { fetchMe } from "@/lib/data";
import { endSession } from "@/lib/session";
import { isLocalMode } from "@/lib/mode";
import { FinnosLogo } from "@/components/brand/FinnosLogo";
import { NavMenu } from "@/components/layout/NavMenu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

interface AccountBlockProps {
  compact?: boolean;
  /** Collapsed rail: avatar and sign-out only. */
  iconOnly?: boolean;
}

/** Profile + logout, shown at the top of the drawer and the bottom of the sidebar. */
export function AccountBlock({ compact, iconOnly }: AccountBlockProps) {
  const navigate = useNavigate();
  const local = isLocalMode();
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 5 * 60 * 1000 });
  if (!user) return null;

  const signOut = async () => {
    await endSession();
    navigate("/login");
  };
  if (iconOnly) {
    return (
      <div className="flex flex-col items-center gap-2" data-testid="account-block">
        <div title={user.name} className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 font-heading text-sm font-bold text-primary">
          {local ? <Smartphone className="h-4 w-4" aria-hidden="true" /> : initials(user.name)}
        </div>
        <Button variant="ghost" size="icon" onClick={signOut} aria-label={local ? "Sair da conta local" : "Sair da conta"} title="Sair" data-testid="sidebar-logout-button">
          <LogOut className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-muted/60 px-3 py-2.5" data-testid="account-block">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-heading text-sm font-bold text-primary">
        {local ? <Smartphone className="h-4 w-4" aria-hidden="true" /> : initials(user.name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
        <p className="truncate text-xs text-muted-foreground">{local ? "Conta local" : user.email}</p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={signOut}
        aria-label={local ? "Sair da conta local" : "Sair da conta"}
        data-testid={compact ? "drawer-logout-button" : "sidebar-logout-button"}
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

const WIDTH_KEY = "finnos:sidebar-width";
const RAIL = 72;
const MIN_OPEN = 208;
const MAX_OPEN = 340;
const DEFAULT_OPEN = 256;

function initialWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem(WIDTH_KEY));
    if (saved === RAIL || (saved >= MIN_OPEN && saved <= MAX_OPEN)) return saved;
  } catch { /* storage unavailable */ }
  // Laptops (< 1280px) start with the icon rail so content gets the space.
  return window.innerWidth < 1280 ? RAIL : DEFAULT_OPEN;
}

/** Desktop navigation. One icon toggles open/closed (Ctrl/Cmd+B); dragging the
 * right edge resizes it, snapping to the icon rail when narrowed past ~150px.
 * The width is remembered per device and published as --sidebar-w. */
export function Sidebar() {
  const [width, setWidth] = useState(initialWidth);
  const [dragging, setDragging] = useState(false);
  const lastOpen = useRef(width > RAIL ? width : DEFAULT_OPEN);
  const collapsed = width <= RAIL;

  const commit = useCallback((value: number) => {
    const next = Math.round(value);
    if (next > RAIL) lastOpen.current = next;
    setWidth(next);
    try { window.localStorage.setItem(WIDTH_KEY, String(next)); } catch { /* storage unavailable */ }
  }, []);
  const toggle = useCallback(() => commit(collapsed ? lastOpen.current : RAIL), [collapsed, commit]);

  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-w", `${width}px`);
  }, [width]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
    const move = (e: PointerEvent) => {
      const x = Math.min(MAX_OPEN, e.clientX);
      setWidth(x < 150 ? RAIL : Math.max(MIN_OPEN, x));
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(false);
      const x = Math.min(MAX_OPEN, e.clientX);
      commit(x < 150 ? RAIL : Math.max(MIN_OPEN, x));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <aside
      className={cn("fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-card lg:flex", !dragging && "transition-[width] duration-200 ease-out")}
      style={{ width }}
      data-collapsed={collapsed}
    >
      <div className={collapsed ? "flex flex-col items-center gap-3 px-2 pb-2 pt-5" : "flex items-center justify-between gap-2 px-5 pb-2 pt-6"}>
        <FinnosLogo iconOnly={collapsed} className={collapsed ? "h-9 w-9" : "w-32"} />
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          className="h-9 w-9 text-muted-foreground hover:text-foreground"
          aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expandir menu (Ctrl+B)" : "Recolher menu (Ctrl+B)"}
          data-testid="sidebar-toggle"
        >
          <ToggleIcon className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
        </Button>
      </div>
      <div className={collapsed ? "flex-1 overflow-y-auto px-2 py-4" : "flex-1 overflow-y-auto px-3 py-4"} data-testid="sidebar-nav">
        <NavMenu animate={false} collapsed={collapsed} />
      </div>
      <div className="border-t border-border p-3">
        <AccountBlock iconOnly={collapsed} />
      </div>
      {/* Drag the edge to resize; narrow past ~150px to snap to the icon rail. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar menu lateral"
        onPointerDown={startDrag}
        onDoubleClick={toggle}
        className={cn("absolute inset-y-0 -right-1 w-2 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-primary after:opacity-0 after:transition-opacity hover:after:opacity-60", dragging && "after:opacity-100")}
        data-testid="sidebar-resize-handle"
      />
    </aside>
  );
}
