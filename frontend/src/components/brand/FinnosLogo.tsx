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
}

export function FinnosLogo({ className, iconOnly = false }: FinnosLogoProps) {
  return (
    <img
      src={iconOnly ? "/brand/finnos-icon.png" : "/brand/finnos-logo.png"}
      alt="FINNOS"
      width={iconOnly ? 1254 : 2170}
      height={iconOnly ? 1254 : 725}
      className={cn(
        "block shrink-0 object-contain",
        iconOnly ? "h-8 w-8" : "h-auto w-36",
        className,
      )}
    />
  );
}
