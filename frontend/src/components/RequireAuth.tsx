import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { isLocalMode } from "@/lib/mode";
import type { User } from "@/types/finnos";
import { FinnosLoading } from "@/components/brand/FinnosLoading";

/** Keep the brand intro brief and independent of video playback. Authentication
 * proceeds in parallel. This guard stays mounted across app navigation. */
export function RequireAuth() {
  const local = isLocalMode();
  const [showIntro, setShowIntro] = useState(true);
  useEffect(() => {
    const introTimer = setTimeout(() => setShowIntro(false), 800);
    return () => {
      clearTimeout(introTimer);
    };
  }, []);
  const { isPending, isError } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet<User>("/auth/me"),
    retry: false,
    enabled: !local,
    staleTime: 5 * 60 * 1000,
  });

  if (!local && isError) return <Navigate to="/login" replace />;
  if (showIntro || (!local && isPending)) {
    return (
      <FinnosLoading
        fullscreen
        title="Entrando no FINNOS"
        description={local ? "Estamos preparando seu painel financeiro." : "Estamos sincronizando sua conta e preparando o painel."}
      />
    );
  }
  return <Outlet />;
}
