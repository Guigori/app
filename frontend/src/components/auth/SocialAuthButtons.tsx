import { Apple } from "lucide-react";
import { Button } from "@/components/ui/button";

function GoogleMark(){return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[13px] font-bold text-[#4285F4] shadow-sm">G</span>}

export function SocialAuthButtons({ onUnavailable }: { onUnavailable: (provider: string) => void }) {
 return <div className="grid grid-cols-2 gap-3">
  <Button type="button" className="h-11 rounded-xl border border-[#070F52] bg-[#070F52] text-white shadow-sm transition-colors hover:border-[#5B35FF] hover:bg-[#5B35FF] active:bg-[#4B2CFF]" onClick={()=>onUnavailable("Apple")}><Apple className="h-5 w-5 fill-current"/> Apple</Button>
  <Button type="button" className="h-11 rounded-xl border border-[#070F52] bg-[#070F52] text-white shadow-sm transition-colors hover:border-[#5B35FF] hover:bg-[#5B35FF] active:bg-[#4B2CFF]" onClick={()=>onUnavailable("Google")}><GoogleMark/> Google</Button>
 </div>
}