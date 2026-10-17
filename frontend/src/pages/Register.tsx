import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api";
import { createEmailAccount, completeEmailVerification, resendAccountVerification, emailSessionError } from "@/lib/emailSession";
import { beginSession } from "@/lib/session";
import { destinationAfterAuthentication, startOnboarding } from "@/lib/onboarding";
import { disableLocalMode, getMode } from "@/lib/mode";
import type { User } from "@/types/finnos";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { openGoogleSession, googleSessionError } from "@/lib/googleSession";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Register() {
  const navigate = useNavigate();
  const meQuery = useQuery({
    queryKey: ["server-me"],
    queryFn: () => apiGet<User>("/auth/me"),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const [step, setStep] = useState<"form" | "code">("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const signupMutation = useMutation({
    mutationFn: () => createEmailAccount(name, email, password),
    onSuccess: (result) => {
      setPassword("");
      setPasswordConfirm("");
      setFormError(result.verificationSent ? null : "Conta criada, mas o envio falhou. Use Reenviar link.");
      setStep("code");
      if (result.verificationSent) toast.success("Enviamos um link de confirmação para o seu e-mail.");
    },
    onError: (error) => setFormError(emailSessionError(error)),
  });

  const verifyMutation = useMutation({
    mutationFn: () => completeEmailVerification(signupMutation.data?.uid || ""),
    onSuccess: async () => {
      if (getMode() === "local") toast.info("Seus dados locais continuam neste aparelho. A transferência para a conta ainda não está disponível.");
      disableLocalMode();
      await beginSession();
      navigate(await destinationAfterAuthentication(true), { replace: true });
    },
    onError: (error) => setFormError(emailSessionError(error)),
  });

  const resendMutation = useMutation({
    mutationFn: () => resendAccountVerification(signupMutation.data?.uid || ""),
    onSuccess: () => toast.success("Novo link enviado."),
    onError: (error) => toast.error(emailSessionError(error)),
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
        <Card className="w-full max-w-xl rounded-[2rem] border-white/30 bg-white text-slate-950 shadow-2xl [--card-spacing:--spacing(6)] sm:[--card-spacing:--spacing(8)] lg:border-slate-200 lg:shadow-none">
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
                  Abra o link de confirmação enviado para <strong>{email}</strong> e volte para continuar.
                </CardDescription>
              </>
            )}
          </CardHeader>
          <CardContent>
            {step === "form" ? <>
              <SocialAuthButtons onGoogle={async () => {
                setFormError(null);
                try {
                  await openGoogleSession(startOnboarding);
                  disableLocalMode();
                  await beginSession();
                  navigate(await destinationAfterAuthentication(), { replace: true });
                } catch (error) {
                  setFormError(googleSessionError(error));
                }
              }} />
              <div className="my-5 flex items-center gap-3 text-xs text-slate-500"><span className="h-px flex-1 bg-slate-200" />ou<span className="h-px flex-1 bg-slate-200" /></div>
              
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
                  <Input className="h-12 rounded-2xl border-[#D9D7E8] bg-[#F8F8FC] px-4 text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,.8)] placeholder:text-slate-400 focus-visible:border-[#5B35FF] focus-visible:ring-[#5B35FF]/15" id="register-name" autoComplete="name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="Como devemos te chamar?" data-testid="register-name-input" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-email">E-mail</Label>
                  <Input className="h-12 rounded-2xl border-[#D9D7E8] bg-[#F8F8FC] px-4 text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,.8)] placeholder:text-slate-400 focus-visible:border-[#5B35FF] focus-visible:ring-[#5B35FF]/15" id="register-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" data-testid="register-email-input" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-password">Senha</Label>
                  <Input className="h-12 rounded-2xl border-[#D9D7E8] bg-[#F8F8FC] px-4 text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,.8)] placeholder:text-slate-400 focus-visible:border-[#5B35FF] focus-visible:ring-[#5B35FF]/15" id="register-password" type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo de 6 caracteres" data-testid="register-password-input" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-password-confirm">Confirmar senha</Label>
                  <Input
                    id="register-password-confirm"
                    className="h-12 rounded-2xl border-[#D9D7E8] bg-[#F8F8FC] px-4 text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,.8)] placeholder:text-slate-400 focus-visible:border-[#5B35FF] focus-visible:ring-[#5B35FF]/15"
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
            </> : (
              <form
                className="space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  setFormError(null);
                  verifyMutation.mutate();
                }}
                data-testid="verify-email-form"
              >
                {formError ? (
                  <p role="alert" className="text-sm font-medium text-destructive" data-testid="verify-form-error">
                    {formError}
                  </p>
                ) : null}

                <Button type="submit" className="h-12 w-full rounded-xl" disabled={verifyMutation.isPending} data-testid="verify-submit-button">
                  {verifyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Já confirmei, entrar"}
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
                    Reenviar link
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
