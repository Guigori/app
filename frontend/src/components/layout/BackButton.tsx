import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
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
    <Button
      variant="ghost"
      size="sm"
      onClick={() => fromNotifications ? navigate(-1) : navigate(parentPath)}
      className="-ml-2 mb-2 h-10 gap-1 rounded-full px-2 font-medium text-primary transition-colors hover:bg-primary/5 hover:text-primary focus-visible:ring-primary/30"
      aria-label={fromNotifications ? "Voltar para a central de notificações" : "Voltar para a seção anterior"}
      data-testid="back-button"
    >
      <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      Voltar
    </Button>
  );
}
