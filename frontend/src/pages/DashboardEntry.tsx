import { useEffect, useState } from "react";
import Dashboard from "@/pages/Dashboard";
import DashboardWeb from "@/pages/DashboardWeb";

const DESKTOP_QUERY = "(min-width: 1024px)";

export default function DashboardEntry() {
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setDesktop(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return desktop ? <DashboardWeb /> : <Dashboard />;
}
