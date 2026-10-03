import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

// Official assets: never redraw, crop, recolor, or filter these images.
export function FinnosIcon({ className }: { className?: string }) {
  return (
    <img
      src="/brand/finnos-icon.png"
      alt=""
      aria-hidden="true"
      width={1254}
      height={1254}
      className={cn("block object-contain", className)}
    />
  );
}

interface FinnosLogoProps {
  className?: string;
  iconOnly?: boolean;
  variant?: "auto" | "light" | "dark";
}

export function FinnosLogo({ className, iconOnly = false, variant = "auto" }: FinnosLogoProps) {
  const { resolvedTheme } = useTheme();
  const whiteLogo = variant === "dark" || (variant === "auto" && resolvedTheme === "dark");
  const showIcon = iconOnly;
  return (
    <img
      src={showIcon ? "/brand/finnos-icon.png" : whiteLogo ? "/brand/finnos-logo-white.png" : "/brand/finnos-logo.png"}
      alt="FINNOS"
      width={showIcon ? 1254 : 2170}
      height={showIcon ? 1254 : 725}
      className={cn(
        "block shrink-0 object-contain",
        showIcon ? "h-8 w-8" : "h-auto w-36",
        className,
      )}
    />
  );
}
