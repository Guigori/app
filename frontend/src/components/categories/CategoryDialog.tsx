import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createCategory, updateCategory } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { GROUP_LABEL, parseAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Category, CategoryGroup, CategoryInput } from "@/types/finnos";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CategoryIcon, CATEGORY_ICONS } from "@/components/shared/CategoryIcon";

const CATEGORY_COLORS = ["#F59E0B", "#84CC16", "#070F52", "#06B6D4", "#10B981", "#6366F1", "#8B5CF6", "#EC4899", "#F97316", "#F43F5E", "#0EA5E9", "#64748B"];
const GROUPS: CategoryGroup[] = ["necessidades", "desejos", "metas"];

interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category?: Category;
  defaultGroup?: CategoryGroup;
}

export function CategoryDialog({ open, onOpenChange, category, defaultGroup }: CategoryDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("more-horizontal");
  const [color, setColor] = useState(CATEGORY_COLORS[0]);
  const [group, setGroup] = useState<CategoryGroup>("necessidades");
  const [budgetRaw, setBudgetRaw] = useState("0");
  const [goalRaw, setGoalRaw] = useState("0");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (category) {
      setName(category.name);
      setIcon(category.icon);
      setColor(category.color);
      setGroup(category.group);
      setBudgetRaw(String(category.monthly_budget));
      setGoalRaw(String(category.monthly_goal));
    } else {
      setName("");
      setIcon("more-horizontal");
      setColor(CATEGORY_COLORS[0]);
      setGroup(defaultGroup ?? "necessidades");
      setBudgetRaw("0");
      setGoalRaw("0");
    }
  }, [open, category, defaultGroup]);

  const mutation = useMutation({
    mutationFn: (input: CategoryInput) =>
      category ? updateCategory(category.id, input) : createCategory(input),
    onSuccess: async () => {
      toast.success(category ? "Categoria atualizada." : "Categoria criada.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["categories"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      onOpenChange(false);
    },
    onError: (error) => setFormError(getApiErrorMessage(error)),
  });

  const submit = () => {
    setFormError(null);
    const budget = parseAmount(budgetRaw) ?? 0;
    const goal = parseAmount(goalRaw) ?? 0;
    if (!name.trim()) return setFormError("Dê um nome à categoria.");
    mutation.mutate({
      name: name.trim(),
      icon,
      color,
      group,
      monthly_budget: Math.max(budget, 0),
      monthly_goal: Math.max(goal, 0),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">{category ? "Editar categoria" : "Nova categoria"}</DialogTitle>
          <DialogDescription>
            Cada categoria pertence a um grupo da regra 50/30/20 e pode ter orçamento mensal.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          data-testid="category-form"
        >
          <div className="space-y-2">
            <Label htmlFor="category-name">Nome</Label>
            <Input id="category-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Alimentação, Transporte" maxLength={40} data-testid="category-name-input" />
          </div>

          <div className="space-y-2">
            <Label>Ícone</Label>
            <div className="grid grid-cols-8 gap-1.5" role="group" aria-label="Ícone da categoria" data-testid="category-icon-picker">
              {CATEGORY_ICONS.map((name_) => (
                <button
                  key={name_}
                  type="button"
                  onClick={() => setIcon(name_)}
                  aria-label={`Ícone ${name_}`}
                  aria-pressed={icon === name_}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
                    icon === name_ ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-muted",
                  )}
                  data-testid="category-icon-option"
                >
                  <CategoryIcon name={name_} className="h-4.5 w-4.5" />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Selecionar cor ${c}`}
                  aria-pressed={color === c}
                  className={cn("h-8 w-8 rounded-full border-2 transition-transform", color === c ? "scale-110 border-foreground" : "border-transparent hover:scale-105")}
                  style={{ backgroundColor: c }}
                  data-testid="category-color-swatch"
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Grupo 50/30/20</Label>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Grupo 50/30/20">
              {GROUPS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroup(g)}
                  aria-pressed={group === g}
                  className={cn(
                    "rounded-xl border px-2 py-2 text-xs font-medium transition-colors",
                    group === g ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-muted",
                  )}
                  data-testid={`category-group-${g}`}
                >
                  {GROUP_LABEL[g]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="category-budget">Orçamento mensal (R$)</Label>
              <Input id="category-budget" inputMode="decimal" value={budgetRaw} onChange={(e) => setBudgetRaw(e.target.value)} data-testid="category-budget-input" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-goal">Meta mensal (R$)</Label>
              <Input id="category-goal" inputMode="decimal" value={goalRaw} onChange={(e) => setGoalRaw(e.target.value)} data-testid="category-goal-input" />
            </div>
          </div>

          {formError ? (
            <p role="alert" className="text-sm font-medium text-destructive" data-testid="category-form-error">
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending} data-testid="category-cancel-button">
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="category-submit-button">
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : category ? "Salvar alterações" : "Criar categoria"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
