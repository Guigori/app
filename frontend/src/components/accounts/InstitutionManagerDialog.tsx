import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createInstitution, deleteInstitution, fetchInstitutionCatalog } from "@/lib/data";
import { institutionKey } from "@/lib/institutionGroups";
import { getApiErrorMessage } from "@/lib/errors";
import type { Institution } from "@/types/finnos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export function InstitutionManagerDialog({ open, onOpenChange, institutions }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutions: Institution[];
}) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["institutions"] });
    await client.invalidateQueries({ queryKey: ["accounts"] });
    await client.invalidateQueries({ queryKey: ["cards"] });
  };
  const catalogQuery = useQuery({ queryKey: ["institution-catalog"], queryFn: fetchInstitutionCatalog, staleTime: Infinity, enabled: open });
  const registered = new Set(institutions.map((item) => institutionKey(item.name)));
  const suggestions = (catalogQuery.data ?? []).filter((item) => !registered.has(institutionKey(item.name)));
  const createMutation = useMutation({
    // A catalog entry brings its own name and color; a typed name gets a stable color.
    mutationFn: (value: { name?: string; catalog_id?: string }) => createInstitution(value),
    onSuccess: async () => {
      setName("");
      setError("");
      toast.success("Instituição cadastrada.");
      await refresh();
    },
    onError: e => setError(getApiErrorMessage(e, "Não foi possível cadastrar a instituição.")),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteInstitution(id),
    onSuccess: async () => {
      setDeleting(null);
      toast.success("Instituição excluída.");
      await refresh();
    },
    onError: e => {
      setDeleting(null);
      setError(getApiErrorMessage(e, "Há contas ou cartões vinculados a esta instituição."));
    },
  });

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="font-heading">Instituições financeiras</DialogTitle>
        <DialogDescription>Bancos e empresas de benefício. A cor de cada conta e cartão vem da instituição. A exclusão só é permitida quando nenhuma conta ou cartão está vinculado.</DialogDescription>
      </DialogHeader>
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
        event.preventDefault();
        setError("");
        const trimmed = name.trim().replace(/\s+/g, " ");
        if (trimmed.length < 2 || trimmed.length > 60) {
          setError("Informe um nome entre 2 e 60 caracteres.");
          return;
        }
        createMutation.mutate({ name: trimmed });
      }}>
        <div className="min-w-[180px] flex-1 space-y-2">
          <Label htmlFor="institution-create-name">Nome da instituição</Label>
          <Input id="institution-create-name" maxLength={60} value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: Nubank" />
        </div>
        <Button type="submit" disabled={createMutation.isPending}>Adicionar</Button>
      </form>
      {suggestions.length ? <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Ou toque para adicionar</p>
        <div className="flex flex-wrap gap-2">
          {suggestions.map((item) => <button key={item.id} type="button" disabled={createMutation.isPending} onClick={() => createMutation.mutate({ catalog_id: item.id })}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-semibold hover:bg-muted">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />{item.name}<Plus className="size-3.5 text-muted-foreground" aria-hidden="true" />
          </button>)}
        </div>
      </div> : null}
      {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      <div className="max-h-72 space-y-2 overflow-auto">
        {institutions.length === 0 ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nenhuma instituição cadastrada. Você também pode adicionar uma ao criar sua primeira conta.</p> :
          institutions.map(item => <div key={item.id} className="flex items-center justify-between gap-2 rounded-2xl border border-border p-3">
            <div className="flex min-w-0 items-center gap-2"><span className="size-6 shrink-0 rounded-lg" style={{ backgroundColor: item.color }} aria-hidden="true"/><span className="truncate text-sm font-semibold">{item.name}</span>{item.kind === "beneficio" ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Benefício</span> : null}</div>
            {deleting === item.id ? <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>Cancelar</Button>
              <Button size="sm" variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(item.id)}>Confirmar exclusão</Button></div> :
              <Button size="icon-sm" variant="ghost" aria-label={"Excluir instituição " + item.name} onClick={() => { setDeleting(item.id); setError(""); }}><Trash2 className="h-4 w-4"/></Button>}
          </div>)
        }
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
