import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Smartphone } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/errors";
import { beginSession } from "@/lib/session";
import { disableLocalMode, enableLocalMode } from "@/lib/mode";
import type { User } from "@/types/finnos";
import { FinnosLogo } from "@/components/brand/FinnosLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DEMO_CREDENTIALS = { email: "demo@finnos.app", password: "demo1234" };

export default function Login() {
  const navigate = useNavigate();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet<User>("/auth/me"),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);

  const loginMutation = useMutation({
    mutationFn: (credentials: { email: string; password: string }) => apiPost<User>("/auth/login", credentials),
    onSuccess: async () => {
      disableLocalMode();
      await beginSession();
      navigate("/", { replace: true });
    },
    onError: (error) => setFormError(getApiErrorMessage(error, "E-mail ou senha incorretos.")),
  });

  const startLocalMode = async () => {
    enableLocalMode();
    await beginSession();
    navigate("/", { replace: true });
  };

  if (meQuery.isSuccess) return <Navigate to="/" replace />;

  const submit = (credentials: { email: string; password: string }) => {
    setFormError(null);
    loginMutation.mutate(credentials);
  };

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#10142B] p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-[#5B3FE4]/40 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-[#8B74F0]/20 blur-3xl" aria-hidden="true" />
        <span className="relative font-heading text-2xl font-extrabold tracking-tight">FINNOS</span>
        <div className="relative">
          <h1 className="max-w-md font-heading text-4xl font-bold leading-tight tracking-tight">
            Sua vida financeira em um só lugar.
          </h1>
          <p className="mt-4 max-w-md text-base text-white/70">
            Receitas, despesas, contas e metas organizadas de forma simples e visual — com a regra 50/30/20
            sempre à vista.
          </p>
          <div className="mt-8 flex flex-wrap gap-2" aria-hidden="true">
            <span className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold">Necessidades · 50%</span>
            <span className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold">Desejos · 30%</span>
            <span className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold">Metas · 20%</span>
          </div>
        </div>
        <p className="relative text-sm text-white/50">Seus dados, organizados com clareza e privacidade.</p>
      </aside>

      <main className="flex items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="mb-2 lg:hidden">
              <FinnosLogo />
            </div>
            <CardTitle className="font-heading text-2xl font-bold">Entrar</CardTitle>
            <CardDescription>Bem-vindo de volta ao seu painel financeiro.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                submit({ email: email.trim(), password });
              }}
              data-testid="login-form"
            >
              <div className="space-y-2">
                <Label htmlFor="login-email">E-mail</Label>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@email.com"
                  data-testid="login-email-input"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="login-password">Senha</Label>
                  <button
                    type="button"
                    onClick={() => setForgotOpen(true)}
                    className="text-xs font-medium text-primary hover:underline"
                    data-testid="forgot-password-button"
                  >
                    Esqueci minha senha
                  </button>
                </div>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Sua senha"
                  data-testid="login-password-input"
                />
              </div>

              {formError ? (
                <p role="alert" className="text-sm font-medium text-destructive" data-testid="login-form-error">
                  {formError}
                </p>
              ) : null}

              <Button type="submit" className="w-full" disabled={loginMutation.isPending} data-testid="login-submit-button">
                {loginMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Entrar"}
              </Button>
            </form>

            <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              ou
              <span className="h-px flex-1 bg-border" />
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => submit(DEMO_CREDENTIALS)}
              disabled={loginMutation.isPending}
              data-testid="demo-login-button"
            >
              Entrar com a conta demo
            </Button>

            <Button
              variant="ghost"
              className="mt-2 w-full"
              onClick={startLocalMode}
              data-testid="local-mode-button"
            >
              <Smartphone className="h-4 w-4" aria-hidden="true" />
              Usar sem cadastro (só neste aparelho)
            </Button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Na conta local nada é enviado para servidores — e limpar os dados do navegador apaga tudo.
            </p>

            <p className="mt-5 text-center text-sm text-muted-foreground">
              Não tem uma conta?{" "}
              <Link to="/cadastro" className="font-semibold text-primary hover:underline" data-testid="go-to-register-link">
                Criar conta
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">Recuperação de senha</DialogTitle>
            <DialogDescription>
              Em breve: a recuperação de senha por e-mail chega em uma próxima entrega do FINNOS. Enquanto isso,
              entre em contato com o suporte se precisar de ajuda.
            </DialogDescription>
          </DialogHeader>
          <Button onClick={() => setForgotOpen(false)} data-testid="forgot-password-close-button">
            Entendi
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
