import { useEffect, useState } from "react";
import { CheckCircle2, Compass, Copy, Download, PlusSquare, Share } from "lucide-react";
import { toast } from "sonner";
import { installPlatform, isInstalled, rememberDismissed, shouldOffer, type InstallPlatform } from "@/lib/installApp";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** Chromium's install event (Android): lets the app show its own "Instalar" button. */
interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }

const STEPS: Record<"iphone" | "android", Array<{ icon: typeof Share; text: string }>> = {
  iphone: [
    { icon: Compass, text: "Abra o FINNOS no Safari. No iPhone, é o Safari que instala apps da web." },
    { icon: Share, text: "Toque em Compartilhar (o quadrado com a seta para cima), na barra do Safari." },
    { icon: PlusSquare, text: "Role a lista, toque em \"Adicionar à Tela de Início\" e depois em \"Adicionar\"." },
    { icon: CheckCircle2, text: "Pronto: o FINNOS aparece na tela de início e abre em tela cheia, como um app." },
  ],
  android: [
    { icon: Compass, text: "Abra o FINNOS no Chrome." },
    { icon: Download, text: "Toque no menu ⋮ e em \"Instalar app\" (ou \"Adicionar à tela inicial\")." },
    { icon: CheckCircle2, text: "Pronto: o FINNOS abre pela tela inicial, em tela cheia." },
  ],
};

/**
 * Offers to install FINNOS on the phone: on its own a few seconds after opening (at most every 14 days,
 * never when already installed), and on request from Configurações ("finnos-install-open").
 */
export function InstallAppPrompt() {
  const [platform] = useState<InstallPlatform>(() => (typeof navigator === "undefined" ? "other" : installPlatform()));
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"iphone" | "android">(platform === "android" ? "android" : "iphone");
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => { event.preventDefault(); setDeferred(event as InstallEvent); };
    const onOpen = () => setOpen(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("finnos-install-open", onOpen);
    const phone = platform === "ios-safari" || platform === "ios-other" || platform === "android";
    const timer = phone && !isInstalled() && shouldOffer() ? window.setTimeout(() => setOpen(true), 3500) : undefined;
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("finnos-install-open", onOpen);
      if (timer) window.clearTimeout(timer);
    };
  }, [platform]);

  const close = (next: boolean) => { if (!next) rememberDismissed(); setOpen(next); };
  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    if (choice.outcome === "accepted") { setOpen(false); toast.success("FINNOS instalado. Abra pela tela inicial."); }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.origin); toast.success("Link copiado. Cole no Safari."); } catch { toast.error("Não consegui copiar. O endereço é " + window.location.host); }
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="bottom" className="max-h-[90svh] gap-0 overflow-y-auto rounded-t-3xl p-0" data-testid="install-app">
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" aria-hidden="true" />
        <div className="mx-auto w-full max-w-md space-y-4 p-5 pb-8">
          <div className="pr-8">
            <SheetTitle className="font-heading text-xl font-bold">Instale o FINNOS no celular</SheetTitle>
            <SheetDescription className="mt-1 text-sm">Abre direto da tela inicial, em tela cheia, e no iPhone é assim que os avisos de vencimento chegam.</SheetDescription>
          </div>

          {platform === "android" && deferred ? (
            <button type="button" onClick={() => void install()} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-primary-foreground" data-testid="install-app-now">
              <Download className="h-5 w-5" aria-hidden="true" />Instalar agora
            </button>
          ) : null}

          <div className="grid grid-cols-2 gap-1 rounded-full border border-border bg-muted/60 p-1" role="tablist" aria-label="Celular">
            {(["android", "iphone"] as const).map((key) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                className={cn("rounded-full py-2 text-sm font-semibold transition-colors", tab === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
                {key === "android" ? "Android" : "iPhone"}
              </button>
            ))}
          </div>

          {tab === "iphone" && platform === "ios-other" ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm" data-testid="install-app-not-safari">
              Você está em outro navegador. Copie o link e abra no Safari para instalar.
              <button type="button" onClick={() => void copyLink()} className="mt-2 inline-flex items-center gap-1.5 font-semibold text-primary"><Copy className="h-4 w-4" aria-hidden="true" />Copiar link</button>
            </div>
          ) : null}

          <ol className="space-y-2">
            {STEPS[tab].map((step, i) => (
              <li key={step.text} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">{i + 1}</span>
                <step.icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm leading-snug">{step.text}</span>
              </li>
            ))}
          </ol>

          <button type="button" onClick={() => close(false)} className="h-11 w-full rounded-2xl border border-border text-sm font-semibold" data-testid="install-app-later">Agora não</button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
