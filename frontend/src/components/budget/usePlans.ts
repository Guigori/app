/** Orçamento: plans and closings of every month, read once and shared by the screens (react-query). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { emptyPlan, endBudgetSpecial, fetchBudgetClosings, fetchBudgetPlans, fetchBudgetSpecials, reopenBudgetClosing, saveBudgetClosing, saveBudgetPlan, saveBudgetSpecial, type BudgetClosing, type BudgetPlan, type BudgetSpecial } from "@/lib/budget/server";
import { getApiErrorMessage } from "@/lib/errors";

export function useBudgetPlans() {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ["budget-plans"], queryFn: fetchBudgetPlans, staleTime: 60_000 });
  const planOf = (month: string): BudgetPlan => plans.data?.find((p) => p.month === month) ?? emptyPlan(month);
  const save = useMutation({
    mutationFn: saveBudgetPlan,
    onMutate: async (plan) => {
      await qc.cancelQueries({ queryKey: ["budget-plans"] });
      qc.setQueryData<BudgetPlan[]>(["budget-plans"], (cur = []) => [...cur.filter((p) => p.month !== plan.month), plan]);
    },
    onSuccess: (state) => { if (state === "queued") toast.message("Sem conexão: o plano fica neste aparelho e é enviado quando a internet voltar."); },
    onError: (e) => { toast.error(getApiErrorMessage(e)); void qc.invalidateQueries({ queryKey: ["budget-plans"] }); },
  });
  /** Approving or leaving out an item of a month (from any screen) keeps everything else of that month's plan. */
  const decide = (month: string, key: string, d: "approve" | "ignore" | "undo") => {
    const cur = planOf(month);
    const approved = cur.approved.filter((k) => k !== key), ignored = cur.ignored.filter((k) => k !== key);
    if (d === "approve") approved.push(key);
    if (d === "ignore") ignored.push(key);
    save.mutate({ ...cur, approved, ignored });
  };
  /** Includes or leaves out a special plan in a month (the plan's limits count only when included). */
  const includeSpecial = (month: string, id: string, on: boolean) => {
    const cur = planOf(month);
    const specials = (cur.specials ?? []).filter((x) => x !== id);
    if (on) specials.push(id);
    save.mutate({ ...cur, specials });
  };
  return { loading: plans.isPending, planOf, save, decide, includeSpecial };
}

export function useBudgetClosings() {
  const qc = useQueryClient();
  const closings = useQuery({ queryKey: ["budget-closings"], queryFn: fetchBudgetClosings, staleTime: 60_000 });
  const close = useMutation({
    mutationFn: saveBudgetClosing,
    onMutate: async (c) => { qc.setQueryData<BudgetClosing[]>(["budget-closings"], (cur = []) => [...cur.filter((x) => x.month !== c.month), c]); },
    onSuccess: (state) => { if (state === "queued") toast.message("Sem conexão: o fechamento fica neste aparelho e é enviado quando a internet voltar."); },
    onError: (e) => { toast.error(getApiErrorMessage(e)); void qc.invalidateQueries({ queryKey: ["budget-closings"] }); },
  });
  const reopen = useMutation({
    mutationFn: reopenBudgetClosing,
    onMutate: async (month) => { qc.setQueryData<BudgetClosing[]>(["budget-closings"], (cur = []) => cur.filter((x) => x.month !== month)); },
    onError: (e) => { toast.error(getApiErrorMessage(e)); void qc.invalidateQueries({ queryKey: ["budget-closings"] }); },
  });
  return { loading: closings.isPending, all: closings.data ?? [], closingOf: (m: string) => closings.data?.find((c) => c.month === m) ?? null, close, reopen };
}

/** Planos especiais (viagem, Natal…): saved on the server like the plans, offline in the device queue. */
export function useBudgetSpecials() {
  const qc = useQueryClient();
  const specials = useQuery({ queryKey: ["budget-specials"], queryFn: fetchBudgetSpecials, staleTime: 60_000 });
  const save = useMutation({
    mutationFn: saveBudgetSpecial,
    onMutate: async (sp) => { qc.setQueryData<BudgetSpecial[]>(["budget-specials"], (cur = []) => [...cur.filter((x) => x.id !== sp.id), sp].sort((a, b) => a.start.localeCompare(b.start))); },
    onSuccess: (state) => { if (state === "queued") toast.message("Sem conexão: o plano fica neste aparelho e é enviado quando a internet voltar."); },
    onError: (e) => { toast.error(getApiErrorMessage(e)); void qc.invalidateQueries({ queryKey: ["budget-specials"] }); },
  });
  const end = useMutation({
    mutationFn: endBudgetSpecial,
    onMutate: async (id) => { qc.setQueryData<BudgetSpecial[]>(["budget-specials"], (cur = []) => cur.filter((x) => x.id !== id)); },
    onError: (e) => { toast.error(getApiErrorMessage(e)); void qc.invalidateQueries({ queryKey: ["budget-specials"] }); },
  });
  return { loading: specials.isPending, all: specials.data ?? [], save, end };
}
