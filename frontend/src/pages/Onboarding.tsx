import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, FileSpreadsheet, Keyboard, Landmark, ReceiptText, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { fetchAccounts } from "@/lib/data";
import { useDialogs } from "@/components/dialogs/DialogsProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Method = "manual" | "statement" | "invoice" | null;

function parsePreview(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const data = lines.filter((line) => /\d/.test(line)).slice(0, 200);
  const normalized = data.map((line) => line.split(/[;,\t]/).map((part) => part.trim()).filter(Boolean));
  const merchants = new Map<string, number>();
  for (const row of normalized) {
    const label = row.find((cell) => /[A-Za-zÀ-ÿ]{3}/.test(cell) && !/^\d{2}[/-]\d{2}/.test(cell));
    if (label) merchants.set(label.toLowerCase(), (merchants.get(label.toLowerCase()) ?? 0) + 1);
  }
  return { rows: normalized.length, recurring: [...merchants.values()].filter((count) => count >= 2).length };
}

export default function Onboarding() {
  const navigate = useNavigate();
  const dialogs = useDialogs();
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const accounts = accountsQuery.data ?? [];
  const [method, setMethod] = useState<Method>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<{ rows: number; recurring: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasAccount = accounts.length > 0;

  const finish = () => {
    window.localStorage.setItem("finnos:onboarding:completed", "1");
    navigate("/", { replace: true });
  };

  const readFile = async (file: File) => {
    setFileName(file.name);
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "csv" || ext === "ofx" || ext === "qfx" || ext === "txt") {
      const text = await file.text();
      setPreview(parsePreview(text));
    } else {
      setPreview({ rows: 0, recurring: 0 });
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-2 sm:py-6">
      <div className="rounded-[2rem] border border-primary/15 bg-primary/[0.04] p-6 sm:p-8">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><Sparkles className="h-5 w-5" /></div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-primary">Primeiros passos</p>
        <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight">Vamos preparar seu FINNOS.</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Primeiro cadastre onde seu dinheiro vive. Depois você escolhe se quer começar manualmente ou usar um extrato/fatura para acelerar a configuração.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className={hasAccount ? "border-primary/30" : ""}><CardContent className="p-5">
          <div className="flex items-center gap-3"><Landmark className="h-5 w-5 text-primary" /><p className="font-semibold">1. Cadastre uma conta</p></div>
          <p className="mt-2 text-sm text-muted-foreground">Nubank, Itaú, Inter, salário, poupança ou carteira.</p>
          {hasAccount ? <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-emerald-600"><CheckCircle2 className="h-4 w-4" /> {accounts[0].name} cadastrada</p> : <Button className="mt-4 w-full" onClick={() => dialogs.openAccount()}>Cadastrar primeira conta</Button>}
        </CardContent></Card>

        <Card className={!hasAccount ? "opacity-60" : ""}><CardContent className="p-5">
          <div className="flex items-center gap-3"><FileSpreadsheet className="h-5 w-5 text-primary" /><p className="font-semibold">2. Escolha como começar</p></div>
          <p className="mt-2 text-sm text-muted-foreground">Manual, extrato bancário ou fatura do cartão.</p>
          <Button variant="outline" className="mt-4 w-full" disabled={!hasAccount} onClick={() => setMethod("manual")}>Escolher método</Button>
        </CardContent></Card>

        <Card className={!method ? "opacity-60" : ""}><CardContent className="p-5">
          <div className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-primary" /><p className="font-semibold">3. Revise e confirme</p></div>
          <p className="mt-2 text-sm text-muted-foreground">O FINNOS nunca grava uma detecção financeira sem sua confirmação.</p>
        </CardContent></Card>
      </div>

      {hasAccount ? <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
        <h2 className="font-heading text-xl font-bold">Como você quer adicionar seus primeiros dados?</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <button onClick={() => { setMethod("manual"); setPreview(null); }} className={"rounded-2xl border p-4 text-left transition hover:border-primary/50 " + (method === "manual" ? "border-primary bg-primary/5" : "border-border")}><Keyboard className="h-5 w-5 text-primary" /><p className="mt-3 font-semibold">Manual</p><p className="mt-1 text-xs text-muted-foreground">Entre agora e registre receitas e despesas conforme usa o FINNOS.</p></button>
          <button onClick={() => { setMethod("statement"); setPreview(null); }} className={"rounded-2xl border p-4 text-left transition hover:border-primary/50 " + (method === "statement" ? "border-primary bg-primary/5" : "border-border")}><Upload className="h-5 w-5 text-primary" /><p className="mt-3 font-semibold">Extrato</p><p className="mt-1 text-xs text-muted-foreground">Analise CSV, OFX ou QFX antes de importar os lançamentos.</p></button>
          <button onClick={() => { setMethod("invoice"); setPreview(null); }} className={"rounded-2xl border p-4 text-left transition hover:border-primary/50 " + (method === "invoice" ? "border-primary bg-primary/5" : "border-border")}><ReceiptText className="h-5 w-5 text-primary" /><p className="mt-3 font-semibold">Fatura</p><p className="mt-1 text-xs text-muted-foreground">Anexe a fatura para o FINNOS preparar a revisão das compras.</p></button>
        </div>

        {method === "manual" ? <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-muted/50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">Tudo certo para começar.</p><p className="text-sm text-muted-foreground">Você poderá importar arquivos depois, sem perder o que registrar manualmente.</p></div><Button onClick={finish}>Entrar no FINNOS <ArrowRight className="h-4 w-4" /></Button></div> : null}

        {method === "statement" || method === "invoice" ? <div className="mt-5 rounded-2xl border border-dashed border-border p-5">
          <input ref={inputRef} className="hidden" type="file" accept=".csv,.ofx,.qfx,.txt,.pdf" onChange={(e) => { const file=e.target.files?.[0]; if(file) void readFile(file); }} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{method === "statement" ? "Anexar extrato" : "Anexar fatura"}</p><p className="text-sm text-muted-foreground">CSV/OFX/QFX têm pré-análise local. PDF fica anexado para a etapa de extração do backend, sem gravação automática.</p></div><Button variant="outline" onClick={() => inputRef.current?.click()}><Upload className="h-4 w-4" /> Selecionar arquivo</Button></div>
          {fileName ? <div className="mt-4 rounded-xl bg-muted/60 p-4"><p className="font-semibold">{fileName}</p>{preview && preview.rows > 0 ? <p className="mt-1 text-sm text-muted-foreground">Pré-análise: {preview.rows} linhas financeiras encontradas · {preview.recurring} possíveis padrões recorrentes. A importação definitiva exige revisão.</p> : <p className="mt-1 text-sm text-muted-foreground">Arquivo recebido. Nenhum dado será lançado sem revisão e confirmação.</p>}</div> : null}
          {fileName ? <div className="mt-4 flex justify-end"><Button onClick={finish}>Continuar para revisão <ArrowRight className="h-4 w-4" /></Button></div> : null}
        </div> : null}
      </section> : null}
    </div>
  );
}
