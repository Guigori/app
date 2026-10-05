import { useMemo } from "react";
import { CheckCircle2, Repeat2 } from "lucide-react";
import type { Account, Category } from "@/types/finnos";
import type { ImportRow } from "@/lib/importFinancial";
import { Button } from "@/components/ui/button";

const money=(v:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v);

export function ImportReview({rows,setRows,accounts,categories,accountId,setAccountId,onConfirm,busy}:{rows:ImportRow[];setRows:(rows:ImportRow[])=>void;accounts:Account[];categories:Category[];accountId:string;setAccountId:(id:string)=>void;onConfirm:()=>void;busy:boolean}){
  const selected=useMemo(()=>rows.filter(r=>r.selected),[rows]);
  const total=selected.reduce((s,r)=>s+(r.type==="despesa"?-r.value:r.value),0);
  const patch=(id:string,p:Partial<ImportRow>)=>setRows(rows.map(r=>r.id===id?{...r,...p}:r));
  return <div className="mt-5 space-y-4">
    <div className="grid gap-3 rounded-2xl bg-muted/50 p-4 sm:grid-cols-3">
      <div><p className="text-xs text-muted-foreground">Selecionados</p><p className="text-lg font-bold">{selected.length}</p></div>
      <div><p className="text-xs text-muted-foreground">Impacto líquido</p><p className="text-lg font-bold">{money(total)}</p></div>
      <label className="text-xs text-muted-foreground">Conta de destino<select className="mt-1 h-10 w-full rounded-xl border bg-background px-3 text-sm text-foreground" value={accountId} onChange={e=>setAccountId(e.target.value)}>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    </div>
    <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
      {rows.map(row=><div key={row.id} className={"grid gap-3 rounded-2xl border p-3 sm:grid-cols-[auto_1fr_130px_170px] sm:items-center "+(row.selected?"border-border":"opacity-50")}>
        <input aria-label="Importar lançamento" type="checkbox" checked={row.selected} onChange={e=>patch(row.id,{selected:e.target.checked})}/>
        <div><input className="w-full bg-transparent text-sm font-semibold outline-none" value={row.description} onChange={e=>patch(row.id,{description:e.target.value})}/><div className="mt-1 flex gap-2 text-xs text-muted-foreground"><span>{new Date(row.date+"T12:00:00").toLocaleDateString("pt-BR")}</span>{row.recurring_candidate?<span className="flex items-center gap-1 text-primary"><Repeat2 className="h-3 w-3"/> possível recorrência</span>:null}</div></div>
        <input className="h-9 rounded-xl border bg-background px-2 text-sm" inputMode="decimal" value={row.value} onChange={e=>patch(row.id,{value:Number(e.target.value.replace(",","."))||0})}/>
        <select className="h-9 rounded-xl border bg-background px-2 text-sm" value={row.category_id??""} onChange={e=>patch(row.id,{category_id:e.target.value||null})}><option value="">Sem categoria</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>)}
    </div>
    <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Nada será gravado até você confirmar esta revisão.</p><Button disabled={busy||!selected.length||!accountId} onClick={onConfirm}>{busy?"Importando...":<>Confirmar {selected.length} lançamentos <CheckCircle2 className="h-4 w-4"/></>}</Button></div>
  </div>;
}
