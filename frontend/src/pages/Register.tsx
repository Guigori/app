import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/errors";
import { beginSession } from "@/lib/session";
import { disableLocalMode } from "@/lib/mode";
import type { SignupResult, User } from "@/types/finnos";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Register() {
  const navigate = useNavigate();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet<User>("/auth/me"),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const [step, setStep] = useState<"form" | "code">("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [code, setCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const signupMutation = useMutation({
    mutationFn: () =>
      apiPost<SignupResult>("/auth/signup", {
        name: name.trim(),
        email: email.trim(),
        password,
        password_confirm: passwordConfirm,
      }),
    onSuccess: () => {
      setFormError(null);
      setStep("code");
      toast.success("Enviamos um código de 6 dígitos para o seu e-mail.");
    },
    onError: (error) => setFormError(getApiErrorMessage(error, "Não foi possível criar sua conta.")),
  });

  const verifyMutation = useMutation({
    mutationFn: () => apiPost<User>("/auth/verify-email", { email: email.trim(), code: code.trim() }),
    onSuccess: async () => {
      disableLocalMode();
      await beginSession();
      navigate("/", { replace: true });
    },
    onError: (error) => setFormError(getApiErrorMessage(error, "Código inválido.")),
  });

  const resendMutation = useMutation({
    mutationFn: () => apiPost<SignupResult>("/auth/resend-code", { email: email.trim() }),
    onSuccess: () => toast.success("Novo código enviado."),
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });

  if (meQuery.isSuccess) return <Navigate to="/" replace />;

  const submitForm = () => {
    setFormError(null);
    if (password !== passwordConfirm) {
      setFormError("As senhas não coincidem.");
      return;
    }
    signupMutation.mutate();
  };

  return (
    <AuthLayout signup>
        <Card className="w-full max-w-md rounded-3xl shadow-sm [--card-spacing:--spacing(6)] sm:[--card-spacing:--spacing(8)]">
          <CardHeader>
            {step === "form" ? (
              <>
                <CardTitle className="font-heading text-2xl font-bold">Criar conta</CardTitle>
                <CardDescription>Leva menos de um minuto.</CardDescription>
              </>
            ) : (
              <>
                <CardTitle className="flex items-center gap-2 font-heading text-2xl font-bold">
                  <MailCheck className="h-6 w-6 text-primary" aria-hidden="true" />
                  Confirme seu e-mail
                </CardTitle>
                <CardDescription>
                  Digite o código de 6 dígitos que enviamos para <strong>{email}</strong>. Ele expira em 15 minutos.
                </CardDescription>
              </>
            )}
          </CardHeader>
          <CardContent>
            {step === "form" ? (
              <form
                className="space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitForm();
                }}
                data-testid="register-form"
              >
                <div className="space-y-2">
                  <Label htmlFor="register-name">Nome</Label>
                  <Input className="h-12 rounded-xl px-4" id="register-name" autoComplete="name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="Como devemos te chamar?" data-testid="register-name-input" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-email">E-mail</Label>
                  <Input className="h-12 rounded-xl px-4" id="register-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" data-testid="register-email-input" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-password">Senha</Label>
                  <Input className="h-12 rounded-xl px-4" id="register-password" type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo de 6 caracteres" data-testid="register-password-input" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-password-confirm">Confirmar senha</Label>
                  <Input
                    id="register-password-confirm"
                    className="h-12 rounded-xl px-4"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    placeholder="Repita a senha"
                    data-testid="register-password-confirm-input"
                  />
                  {passwordConfirm && password !== passwordConfirm ? (
                    <p className="text-xs font-medium text-destructive">As senhas não coincidem.</p>
                  ) : null}
                </div>

                {formError ? (
                  <p role="alert" className="text-sm font-medium text-destructive" data-testid="register-form-error">
                    {formError}
                  </p>
                ) : null}

                <Button type="submit" className="h-12 w-full rounded-xl" disabled={signupMutation.isPending} data-testid="register-submit-button">
                  {signupMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Criar minha conta"}
                </Button>
              </form>
            ) : (
              <form
                className="space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  setFormError(null);
                  verifyMutation.mutate();
                }}
                data-testid="verify-email-form"
              >
                <div className="space-y-2">
                  <Label htmlFor="verify-code">Código de confirmação</Label>
                  <Input
                    id="verify-code"
                    className="h-12 rounded-xl px-4 text-center font-heading text-2xl tracking-[0.5em]"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    pattern="\d{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    
                    data-testid="verify-code-input"
                  />
                </div>

                {formError ? (
                  <p role="alert" className="text-sm font-medium text-destructive" data-testid="verify-form-error">
                    {formError}
                  </p>
                ) : null}

                <Button type="submit" className="h-12 w-full rounded-xl" disabled={verifyMutation.isPending || code.length !== 6} data-testid="verify-submit-button">
                  {verifyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Confirmar e entrar"}
                </Button>
                <div className="flex items-center justify-between text-sm">
                  <button type="button" onClick={() => setStep("form")} className="text-muted-foreground hover:underline" data-testid="verify-change-email-button">
                    Corrigir e-mail
                  </button>
                  <button
                    type="button"
                    onClick={() => resendMutation.mutate()}
                    disabled={resendMutation.isPending}
                    className="font-semibold text-primary hover:underline disabled:opacity-60"
                    data-testid="verify-resend-button"
                  >
                    Reenviar código
                  </button>
                </div>
              </form>
            )}

            <p className="mt-5 text-center text-sm text-muted-foreground">
              Já tem uma conta?{" "}
              <Link to="/login" className="font-semibold text-primary hover:underline" data-testid="go-to-login-link">
                Entrar
              </Link>
            </p>
          </CardContent>
        </Card>
    </AuthLayout>
  );
}
