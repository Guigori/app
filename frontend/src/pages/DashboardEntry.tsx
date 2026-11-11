import { Suspense, useEffect, useState } from "react";
import { lazyRetry } from "@/lib/lazyRetry";
const Dashboard = lazyRetry(() => import("@/pages/Dashboard"));
const DashboardWeb = lazyRetry(() => import("@/pages/DashboardWeb"));

const DESKTOP_QUERY = "(min-width: 1024px)";

export default function DashboardEntry() {
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setDesktop(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return (
    <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground" role="status">Preparando seu Dashboard...</div>}>
      {desktop ? <DashboardWeb /> : <Dashboard />}
    </Suspense>
  );
}
