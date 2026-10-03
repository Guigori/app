import { Apple } from "lucide-react";
import { Button } from "@/components/ui/button";

function GoogleMark(){return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[13px] font-bold text-[#4285F4] shadow-sm">G</span>}

export function SocialAuthButtons({ onUnavailable }: { onUnavailable: (provider: string) => void }) {
 return <div className="space-y-2.5">
  <Button type="button" className="h-11 w-full rounded-xl bg-black text-white hover:bg-black/90" onClick={()=>onUnavailable("Apple")}><Apple className="h-5 w-5 fill-current"/> Continuar com Apple</Button>
  <Button type="button" variant="outline" className="h-11 w-full rounded-xl border-slate-300 bg-white text-slate-950 hover:bg-slate-50" onClick={()=>onUnavailable("Google")}><GoogleMark/> Continuar com Google</Button>
 </div>
}