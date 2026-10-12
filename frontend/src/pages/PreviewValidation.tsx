import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { signInWithCustomToken, signOut } from "firebase/auth";
import { apiGet, apiPost, apiPostWithBearer } from "@/lib/api";
import { firebaseAuth } from "@/lib/firebase";
import { beginSession } from "@/lib/session";
import { getApiErrorMessage } from "@/lib/errors";
import { formatBRL } from "@/lib/format";
import { Button } from "@/components/ui/button";
type ValidationReport = {
  status: string; run_id?: string;
  users: { label: string; name: string; income?: number; expense?: number; total_balance?: number }[];
  checks: { user: string; target?: string; check: string; status: string }[];
};

export default function PreviewValidation() {
  const navigate = useNavigate();
  const report = useQuery({ queryKey: ["preview-finance-validation"], queryFn: () => apiGet<ValidationReport>("/validation/finance"), retry: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function prepare() {
    setBusy(true); setError("");
    try { await apiPost("/validation/finance"); await report.refetch(); }
    catch (failure) { setError(getApiErrorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function login(label: string) {
    if (!firebaseAuth) return;
    setBusy(true); setError("");
    try {
      const { token } = await apiPost<{ token: string }>("/validation/finance/token", { label });
      const session = await signInWithCustomToken(firebaseAuth, token);
      await apiPostWithBearer("/auth/firebase-session", await session.user.getIdToken());
      await beginSession(); navigate("/");
    } catch (failure) {
      await signOut(firebaseAuth).catch(() => undefined);
      setError(getApiErrorMessage(failure));
    } finally { setBusy(false); }
  }
  return <main className="space-y-5">
    <h1 className="text-2xl font-bold">Validação financeira do Preview</h1>
    <p>Contas Firebase exclusivas de teste, sem senha. Os dados são fictícios e ficam isolados no Firestore. A preparação executa os endpoints reais e testa acesso cruzado.</p>
    {(error || report.isError) && <p role="alert">{error || getApiErrorMessage(report.error, "Validação indisponível para esta conta ou ambiente.")}</p>}
    {report.data && <>
      <p role="status">Resultado: {report.data.status === "passed" ? "APROVADO" : report.data.status}</p>
      <Button onClick={prepare} disabled={busy || report.data.status === "passed"}>{busy ? "Executando validação real…" : "Preparar três usuários e validar isolamento"}</Button>
      {report.data.users.map(user => <section key={user.label} className="space-y-2 rounded border p-4">
        <h2 className="font-semibold">{user.name}</h2>
        {user.total_balance !== undefined && <p>Saldo {formatBRL(user.total_balance)} · Receita {formatBRL(user.income ?? 0)} · Despesa {formatBRL(user.expense ?? 0)}</p>}
        {report.data?.status === "passed" && <Button onClick={() => login(user.label)} disabled={busy}>Entrar como teste {user.label}</Button>}
      </section>)}
      <ul>{report.data.checks.map((check, index) => <li key={index}>Teste {check.user}{check.target ? ` → ${check.target}` : ""}: {check.check} — {check.status}</li>)}</ul>
    </>}
  </main>;
}
