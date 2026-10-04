import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Eye, EyeOff, Loader2, MonitorSmartphone, X } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/errors";
import { beginSession } from "@/lib/session";
import { disableLocalMode, enableLocalMode, enableDemoMode } from "@/lib/mode";
import type { User } from "@/types/finnos";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { localLoadDemo, localSetName } from "@/lib/local/engine";

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
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [loginSucceeded, setLoginSucceeded] = useState(false);

  const loginMutation = useMutation({
    mutationFn: (credentials: { email: string; password: string }) => apiPost<User>("/auth/login", credentials),
    onSuccess: async () => {
      disableLocalMode();
      await beginSession();
      navigate("/", { replace: true });
    },
    onError: (error) => { setLoginSucceeded(false); setFormError(getApiErrorMessage(error, "E-mail ou senha incorretos.")); },
  });

  const demoMutation = useMutation({
    mutationFn: async () => {
      enableDemoMode();
      localSetName("Demonstração");
      localLoadDemo();
      await beginSession();
    },
    onSuccess: () => navigate("/", { replace: true }),
    onError: (error) => setFormError(getApiErrorMessage(error, "Não foi possível abrir a demonstração.")),
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
    <>
      <AuthLayout>
        <Card className="w-full max-w-[38rem] rounded-[1.75rem] border-white/30 bg-white text-slate-950 shadow-2xl [--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(6)] lg:border-0 lg:shadow-none">
          <CardHeader className="lg:pt-0">
            <CardTitle className="font-heading text-[2rem] font-bold tracking-tight xl:text-4xl lg:leading-none">Iniciar sessão</CardTitle>
            <CardDescription>Entre para continuar acompanhando suas finanças.</CardDescription>
          </CardHeader>
          <CardContent>
            <SocialAuthButtons onUnavailable={(provider) => setFormError(`Login com ${provider} será ativado assim que a integração OAuth for configurada.`)} />
            <div className="my-5 flex items-center gap-3 text-xs text-slate-500"><span className="h-px flex-1 bg-slate-200" />ou<span className="h-px flex-1 bg-slate-200" /></div>
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
                  className="h-12 rounded-2xl border-[#DCD6FF] !bg-white px-4 text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,.8)] placeholder:text-slate-400 focus-visible:border-[#5B35FF] focus-visible:ring-[#5B35FF]/15"
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
                <div className="relative">
                <Input
                  id="login-password"
                  className="h-12 rounded-2xl border-[#DCD6FF] !bg-white pl-4 pr-12 text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,.8)] placeholder:text-slate-400 focus-visible:border-[#5B35FF] focus-visible:ring-[#5B35FF]/15"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Sua senha"
                  data-testid="login-password-input"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 h-10 w-10 rounded-lg text-muted-foreground"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                </div>
              </div>

              {formError ? (
                <p role="alert" className="text-sm font-medium text-destructive" data-testid="login-form-error">
                  {formError}
                </p>
              ) : null}

              <Button type="submit" className="h-12 w-full rounded-xl bg-[#070F52] text-white transition-colors hover:bg-[#5B35FF] active:bg-[#4B2CFF]" disabled={loginMutation.isPending || demoMutation.isPending} data-testid="login-submit-button">
                {loginMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-label="Entrando" /> : loginSucceeded ? <Check className="h-5 w-5" aria-label="Conectado" /> : "Entrar"}
              </Button>
            </form>

            <p className="mt-5 text-center text-sm text-muted-foreground">
              Não tem uma conta?{" "}
              <Link to="/cadastro" className="font-semibold text-primary hover:underline" data-testid="go-to-register-link">
                Criar conta
              </Link>
            </p>

            <div className="my-4 h-px bg-[#E7E4FF]" />

            <div className="grid grid-cols-2 gap-3">
              <Button
                className="h-11 rounded-xl border border-[#DCD6FF] bg-[#F1EDFF] text-[#4B2CFF] shadow-none transition-colors hover:bg-[#5B35FF] hover:text-white active:bg-[#4B2CFF]"
                onClick={() => { setFormError(null); demoMutation.mutate(); }}
                disabled={loginMutation.isPending || demoMutation.isPending}
                data-testid="demo-login-button"
              >
                {demoMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ver demonstração"}
              </Button>

              <Button
                className="h-11 rounded-xl border border-[#DCD6FF] bg-[#F1EDFF] text-[#4B2CFF] shadow-none transition-colors hover:bg-[#5B35FF] hover:text-white active:bg-[#4B2CFF]"
                onClick={startLocalMode}
                disabled={loginMutation.isPending || demoMutation.isPending}
                data-testid="local-mode-button"
              >
                <MonitorSmartphone className="h-4 w-4" aria-hidden="true" />
                Modo local
              </Button>
            </div>
            <p className="mt-2 text-center text-[11px] leading-snug text-slate-400">
              No modo local, seus dados ficam somente neste dispositivo.
            </p>
          </CardContent>
        </Card>
      </AuthLayout>

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
    </>
  );
}
