import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { canGoBack } from "@/lib/navigation";
import { Button } from "@/components/ui/button";

/** Section roots and their tabs have no back control. Nested screens return
 *  to their parent section, including when opened directly from a link. */
export function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  const segments = location.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  if (segments[0] === "radar" && segments.length === 2) return null;
  const parentPath = `/${segments.slice(0, -1).join("/")}`;
  const fromNotifications = Boolean((location.state as { fromNotifications?: boolean } | null)?.fromNotifications);

  return (
    // A small arrow in a circle: takes little room and scrolls away with the page.
    <Button
      variant="ghost"
      size="icon"
      onClick={() => (fromNotifications || canGoBack() ? navigate(-1) : navigate(parentPath))}
      className="mb-3 size-10 rounded-full border border-border bg-card text-foreground hover:bg-muted"
      aria-label={fromNotifications ? "Voltar para a central de notificações" : "Voltar para a seção anterior"}
      title="Voltar"
      data-testid="back-button"
    >
      <ArrowLeft className="h-5 w-5" aria-hidden="true" />
    </Button>
  );
}
