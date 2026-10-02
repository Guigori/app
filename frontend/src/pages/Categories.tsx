import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, PlusCircle, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteCategory, fetchCategories } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { formatBRL, GROUP_LABEL } from "@/lib/format";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Category, CategoryGroup } from "@/types/finnos";

const GROUPS: CategoryGroup[] = ["necessidades", "desejos", "metas"];

export default function Categories() {
  const dialogs = useDialogs();
  const queryClient = useQueryClient();
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const categories = categoriesQuery.data ?? [];
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    onSuccess: async () => {
      toast.success("Categoria excluída.");
      setPendingDelete(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["categories"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Categorias</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organize seus gastos por grupo da regra 50/30/20 e defina orçamentos mensais.
          </p>
        </div>
        <Button onClick={() => dialogs.openCategory()} data-testid="new-category-button">
          <PlusCircle className="h-4 w-4" aria-hidden="true" />
          Nova categoria
        </Button>
      </div>

      {categoriesQuery.isPending ? (
        <div className="h-48 animate-pulse rounded-3xl bg-muted" aria-hidden="true" />
      ) : categories.length === 0 ? (
        <EmptyState
          icon={<Tags className="h-5 w-5" aria-hidden="true" />}
          title="Nenhuma categoria ainda"
          description="Crie categorias para classificar suas despesas e acompanhar a regra 50/30/20."
          action={
            <Button onClick={() => dialogs.openCategory()} data-testid="categories-empty-create-button">
              Criar categoria
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          {GROUPS.map((group) => {
            const groupCategories = categories.filter((c) => c.group === group);
            return (
              <section key={group} data-testid={`category-group-section-${group}`}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-heading text-base font-semibold text-foreground">{GROUP_LABEL[group]}</h2>
                  <Badge variant="secondary" className="text-xs">
                    {groupCategories.length} {groupCategories.length === 1 ? "categoria" : "categorias"}
                  </Badge>
                </div>
                {groupCategories.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                    Nenhuma categoria neste grupo ainda.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {groupCategories.map((category) => (
                      <Card key={category.id} className="py-0" data-testid={`category-card-${category.id}`}>
                        <CardContent className="flex items-center gap-3 p-4">
                          <span
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                            style={{ backgroundColor: category.color + "1A", color: category.color }}
                            aria-hidden="true"
                          >
                            <CategoryIcon name={category.icon} className="h-5 w-5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-foreground">{category.name}</p>
                            <p className="truncate text-xs text-muted-foreground" data-testid={`category-budget-${category.id}`}>
                              {category.monthly_budget > 0
                                ? `Orçamento: ${formatBRL(category.monthly_budget)}/mês`
                                : "Sem orçamento definido"}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => dialogs.openCategory({ category })}
                              aria-label={`Editar ${category.name}`}
                              data-testid={`edit-category-${category.id}`}
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setPendingDelete(category)}
                              aria-label={`Excluir ${category.name}`}
                              data-testid={`delete-category-${category.id}`}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Excluir categoria?"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" será removida. Categorias com transações vinculadas não podem ser excluídas.`
            : ""
        }
        confirmLabel="Excluir"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}
