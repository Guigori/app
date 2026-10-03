import { Navigate, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { isLocalMode } from "@/lib/mode";
import type { User } from "@/types/finnos";
import { FinnosIcon } from "@/components/brand/FinnosLogo";

function Splash() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background">
      <FinnosIcon className="h-12 w-12" />
      <p className="font-heading text-sm font-semibold tracking-wide text-muted-foreground">FINNOS</p>
    </div>
  );
}

/** Guards the app routes. Local mode needs no server session — the data never
 *  leaves the browser — so it passes straight through. */
export function RequireAuth() {
  const local = isLocalMode();
  const { isPending, isError } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet<User>("/auth/me"),
    retry: false,
    enabled: !local,
    staleTime: 5 * 60 * 1000,
  });

  if (local) return <Outlet />;
  if (isPending) return <Splash />;
  if (isError) return <Navigate to="/login" replace />;
  return <Outlet />;
}
