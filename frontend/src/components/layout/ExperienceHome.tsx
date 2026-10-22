import { Navigate } from "react-router-dom";
import { useExperienceMode } from "@/lib/experienceMode";
import MobileHome from "@/pages/Dashboard";

/** Only landing views auto-switch. Deep links and in-progress forms remain untouched. */
export function ExperienceHome() {
  const mode = useExperienceMode();
  return mode === "dashboard" ? <Navigate to="/dashboard" replace /> : <MobileHome />;
}
