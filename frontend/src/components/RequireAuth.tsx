import { Navigate, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { isLocalMode } from "@/lib/mode";
import type { User } from "@/types/finnos";
import { FinnosLoading } from "@/components/brand/FinnosLoading";

function Splash() {
  return (
    <FinnosLoading
      fullscreen
      title="Entrando no FINNOS"
      description="Estamos sincronizando sua conta e preparando o painel."
    />
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
