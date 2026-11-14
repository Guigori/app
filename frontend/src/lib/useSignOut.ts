import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { endSession } from "@/lib/session";
import { disableLocalMode, getMode } from "@/lib/mode";

/** Leaves the account (or the local/demo session) and goes to the login screen. */
export function useSignOut(): () => Promise<void> {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return async () => {
    // Capture the current mode before clearing it. Local/demo sessions have no server cookie,
    // but account sessions must invalidate it.
    const mode = getMode();
    disableLocalMode();
    try {
      if (mode === "account") await endSession();
      else queryClient.clear();
    } finally {
      // replace keeps the signed-in screen out of the browser history.
      navigate("/login", { replace: true });
    }
  };
}
