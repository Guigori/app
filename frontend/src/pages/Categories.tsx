import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, PlusCircle, Tags, Trash2, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { deleteCategory, fetchCategories, fetchBudget, fetchCurrentBudgetCycle, fetchBudgetCycleProgress } from "@/lib/data";
import { getApiErrorMessage } from "@/lib/errors";
import { formatBRL, GROUP_LABEL } from "@/lib/format";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { CategoryIcon } from "@/components/shared/CategoryIcon";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { FinnosPageLoading } from "@/components/brand/FinnosLoading";
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
  const thisMonth = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const budgetQuery = useQuery({ queryKey: ["budget", thisMonth], queryFn: () => fetchBudget(thisMonth) });
  const paceByCategory = new Map((budgetQuery.data?.rows ?? []).map(row => [row.category_id, row]));
  const cycleQuery = useQuery({ queryKey: ["budget-v2-current"], queryFn: fetchCurrentBudgetCycle });
  const progressQuery = useQuery({
    queryKey: ["budget-v2-progress", cycleQuery.data?.id],
    queryFn: () => fetchBudgetCycleProgress(cycleQuery.data!.id),
    enabled: Boolean(cycleQuery.data?.id),
  });
  const cycleCategories = new Map((progressQuery.data?.allocations ?? []).map(item => [item.category_id, item]));
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    onSuccess: async () => {
      toast.success("Categoria excluída.");
      setPendingDelete(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["categories"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["budget"] }),
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
        <FinnosPageLoading title="Carregando categorias" description="Organizando seus grupos da regra 50/30/20." />
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
                    {groupCategories.map((category) => {
                      const pace = paceByCategory.get(category.id);
                      const cycleAllocation = cycleCategories.get(category.id);
                      const limit = cycleAllocation?.planned ?? category.monthly_budget;
                      const hasLimit = limit > 0;
                      const used = cycleAllocation ? cycleAllocation.spent + cycleAllocation.committed : pace?.spent ?? 0;
                      const usage = cycleAllocation?.percent ?? pace?.percent ?? 0;
                      return (
                      <Card key={category.id} className="py-0" data-testid={`category-card-${category.id}`}>
                        <CardContent className="space-y-3 p-4">
                        <div className="flex items-center gap-3">
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
                              {cycleAllocation
                                ? `Limite do ciclo atual: ${formatBRL(limit)}`
                                : category.monthly_budget > 0
                                  ? `Orçamento mensal: ${formatBRL(category.monthly_budget)}`
                                  : "Sem limite definido"}
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
                        </div>
                        {hasLimit && (cycleAllocation || pace) ? (
                          <div className="space-y-1.5" data-testid={`category-pace-${category.id}`}>
                            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                              <span>{formatBRL(used)} utilizado</span>
                              <span className={usage > 100 ? "font-semibold text-destructive" : ""}>
                                {Math.round(usage)}%
                              </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar"
                              aria-label={`Gastos em ${category.name}`} aria-valuenow={Math.min(Math.round(usage), 100)}
                              aria-valuemin={0} aria-valuemax={100}>
                              <div className={`h-full rounded-full ${usage > 100 ? "bg-destructive" : usage >= 80 ? "bg-amber-500" : "bg-primary"}`}
                                style={{ width: `${Math.min(100, Math.max(0, usage))}%` }} />
                            </div>
                            <div className="flex items-start justify-between gap-2 text-xs text-muted-foreground">
                              <span>{formatBRL(Math.max(limit - used, 0))} disponível</span>
                              <span className="text-right">
                                {!cycleAllocation && pace?.pace_projected_close != null && pace.pace_day && pace.pace_day > 0
                                  ? `Projeção: ${formatBRL(pace.pace_projected_close)}`
                                  : "Sem projeção ainda"}
                              </span>
                            </div>
                            {!cycleAllocation && pace?.pace_daily_allowance != null && pace.pace_day != null
                              && pace.pace_days_in_month != null && pace.pace_day < pace.pace_days_in_month ? (
                              <p className="text-xs text-muted-foreground">
                                <TrendingUp className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                                Até {formatBRL(pace.pace_daily_allowance)}/dia para manter o limite
                              </p>
                            ) : null}
                          </div>
                        ) : !hasLimit ? (
                          <Link className="inline-flex text-xs font-medium text-primary hover:underline" to="/orcamento/configuracoes">
                            Definir limite no orçamento
                          </Link>
                        ) : null}
                        </CardContent>
                      </Card>
                    );})}
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
