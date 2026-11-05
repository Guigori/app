import { Plus, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { canGoBack } from "@/lib/navigation";
/** Dashboard floating "+": on mobile the central button in the bottom bar owns it.
 *  On the register itself it becomes an X that closes it and returns to where the user was. */
export function QuickActionFAB() {
  const navigate = useNavigate();
  const onRegister = useLocation().pathname === "/registro-inteligente";
  return (
    <button type="button" onClick={() => (onRegister ? (canGoBack() ? navigate(-1) : navigate("/")) : navigate("/registro-inteligente"))} className="fixed bottom-4 right-4 dashboard:md:bottom-8 dashboard:md:right-6 z-40 hidden h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-xl active:scale-95 dashboard:flex" aria-label={onRegister ? "Fechar Registro Inteligente" : "Abrir Registro Inteligente"} data-testid="quick-action-fab">
      {onRegister ? <X className="h-6 w-6" aria-hidden="true" /> : <Plus className="h-6 w-6" aria-hidden="true" />}
    </button>
  );
}
