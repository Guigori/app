import { Link } from "react-router-dom";
import { ArrowLeft, Bell, BrainCircuit, LockKeyhole, WalletCards, Zap } from "lucide-react";
const integrations = [
  { name: "Registro por Apple Pay", description: "Automações de compras por aproximação, quando compatíveis com o iOS.", icon: WalletCards },
  { name: "Notificações da Carteira", description: "Importação de dados disponibilizados pelas notificações do iPhone.", icon: Bell },
  { name: "Apple Atalhos", description: "Registros rápidos sem abrir o aplicativo.", icon: Zap },
  { name: "FINNOS IA", description: "Assistente financeiro e integrações de inteligência artificial.", icon: BrainCircuit },
];
export default function SettingsIntegrations() {
  return <main className="mx-auto max-w-2xl space-y-5 pb-28 text-foreground animate-fade-up">
    <Link to="/configuracoes" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4"/> Configurações</Link>
    <div><h1 className="font-heading text-2xl font-bold">Integrações e automações</h1><p className="mt-1 text-sm text-muted-foreground">Novas formas de registrar e acompanhar suas finanças.</p></div>
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {integrations.map((item,index)=><div key={item.name} className={`flex items-start gap-3 p-4 ${index?"border-t border-border":""}`}>
        <span className="rounded-xl bg-primary/10 p-2 text-primary"><item.icon className="h-5 w-5"/></span>
        <div className="min-w-0 flex-1"><p className="font-medium">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{item.description}</p></div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground"><LockKeyhole className="h-3 w-3"/>Em breve</span>
      </div>)}
    </div>
    <p className="text-xs text-muted-foreground">As integrações não estão disponíveis no Beta 1. Nenhuma autorização ou sincronização será iniciada nesta tela.</p>
  </main>;
}
