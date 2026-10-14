import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
/** Dashboard floating "+": on mobile the central button in the bottom bar owns it. */
export function QuickActionFAB() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/registro-inteligente")} className="fixed bottom-4 right-4 dashboard:md:bottom-8 dashboard:md:right-6 z-40 hidden h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-xl active:scale-95 dashboard:flex" aria-label="Abrir Registro Inteligente" data-testid="quick-action-fab">
      <Plus className="h-6 w-6" aria-hidden="true" />
    </button>
  );
}
