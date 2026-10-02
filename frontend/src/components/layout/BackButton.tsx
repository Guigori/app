import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Back control for every screen other than the dashboard: steps through history
 *  when there is one, and falls back to the dashboard on a deep link. */
export function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  if (location.pathname === "/") return null;

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={goBack}
      className="-ml-2 gap-1.5 text-muted-foreground hover:text-foreground"
      aria-label="Voltar para a tela anterior"
      data-testid="back-button"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Voltar
    </Button>
  );
}
