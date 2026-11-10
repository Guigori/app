import { Navigate, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/lib/data";
import { cachedSessionProfile } from "@/lib/profileIdentity";
import { isLocalMode } from "@/lib/mode";

import { FinnosLoading } from "@/components/brand/FinnosLoading";

/** Shows the themed loading screen only while the session is resolved; no fixed
 * intro delay. This guard stays mounted across app navigation.
 *
 * Opening the app again on the same iPhone does not wait for the server: when this device
 * already has the signed-in Firebase user and the profile it saved for them, the app shows
 * right away and /auth/me confirms in the background (cold servers take seconds). If the
 * confirmation fails, the person goes to the login exactly as before. */
export function RequireAuth() {
  const local = isLocalMode();
  const { isPending, isError } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const known = useQuery({
    queryKey: ["me-cached"],
    queryFn: cachedSessionProfile,
    enabled: !local,
    retry: false,
    staleTime: Infinity,
  });

  if (isError) return <Navigate to="/login" replace />;
  if (isPending && !known.data) {
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
