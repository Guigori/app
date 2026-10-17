import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Landmark, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createInstitution, deleteInstitution } from "@/lib/data";
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
  const createMutation = useMutation({
    mutationFn: (value: string) => createInstitution({ name: value, color: "#5B35FF" }),
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
        <DialogDescription>Cadastre bancos e organize seus produtos. A exclusão só é permitida quando nenhuma conta ou cartão está vinculado.</DialogDescription>
      </DialogHeader>
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
        event.preventDefault();
        setError("");
        const trimmed = name.trim().replace(/\s+/g, " ");
        if (trimmed.length < 2 || trimmed.length > 60) {
          setError("Informe um nome entre 2 e 60 caracteres.");
          return;
        }
        createMutation.mutate(trimmed);
      }}>
        <div className="min-w-[180px] flex-1 space-y-2">
          <Label htmlFor="institution-create-name">Nome da instituição</Label>
          <Input id="institution-create-name" maxLength={60} value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: Nubank" />
        </div>
        <Button type="submit" disabled={createMutation.isPending}>Adicionar</Button>
      </form>
      {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      <div className="max-h-72 space-y-2 overflow-auto">
        {institutions.length === 0 ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nenhuma instituição cadastrada. Você também pode adicionar uma ao criar sua primeira conta.</p> :
          institutions.map(item => <div key={item.id} className="flex items-center justify-between gap-2 rounded-2xl border border-border p-3">
            <div className="flex min-w-0 items-center gap-2"><Landmark className="h-4 w-4 shrink-0 text-primary"/><span className="truncate text-sm font-semibold">{item.name}</span></div>
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
