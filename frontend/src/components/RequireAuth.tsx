import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { isLocalMode } from "@/lib/mode";
import type { User } from "@/types/finnos";
import { FinnosLoading } from "@/components/brand/FinnosLoading";

/** Show the entry animation for browser sessions and authenticated accounts.
 * Timing starts when playback actually begins; the fallback prevents a blocked video
 * from blocking access. This guard stays mounted across app navigation. */
export function RequireAuth() {
  const local = isLocalMode();
  const [showIntro, setShowIntro] = useState(true);
  const playbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const fallback = setTimeout(() => setShowIntro(false), 6000);
    return () => {
      clearTimeout(fallback);
      if (playbackTimer.current) clearTimeout(playbackTimer.current);
    };
  }, []);
  const onVideoPlaying = useCallback(() => {
    if (!playbackTimer.current) {
      playbackTimer.current = setTimeout(() => setShowIntro(false), 3000);
    }
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
        onVideoPlaying={onVideoPlaying}
      />
    );
  }
  return <Outlet />;
}
