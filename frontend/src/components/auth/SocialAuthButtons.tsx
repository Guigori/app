import { Apple } from "lucide-react";
import { Button } from "@/components/ui/button";

function GoogleMark(){return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[13px] font-bold text-[#4285F4] shadow-sm">G</span>}

export function SocialAuthButtons({ onUnavailable }: { onUnavailable: (provider: string) => void }) {
 return <div className="grid grid-cols-2 gap-3">
  <Button type="button" className="h-11 rounded-xl bg-[#070F52] text-white shadow-sm hover:bg-[#0B176B]" onClick={()=>onUnavailable("Apple")}><Apple className="h-5 w-5 fill-current"/> Apple</Button>
  <Button type="button" className="h-11 rounded-xl border border-[#DCD6FF] bg-[#F1EDFF] text-[#070F52] shadow-none hover:bg-[#E8E1FF]" onClick={()=>onUnavailable("Google")}><GoogleMark/> Google</Button>
 </div>
}