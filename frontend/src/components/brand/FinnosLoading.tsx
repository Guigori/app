import { cn } from "@/lib/utils";
import { FinnosLogo } from "@/components/brand/FinnosLogo";

const VIDEO = {
  primary: "/brand/finnos-loading-primary.mp4",
  secondary: "/brand/finnos-loading-secondary.mp4",
};

type FinnosLoadingProps = {
  title?: string;
  description?: string;
  fullscreen?: boolean;
  video?: keyof typeof VIDEO;
  className?: string;
  onVideoPlaying?: () => void;
};

export function FinnosLoading({
  title = "Carregando seus dados",
  description = "Estamos preparando sua visão financeira.",
  fullscreen = false,
  video = "primary",
  className,
  onVideoPlaying,
}: FinnosLoadingProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center overflow-hidden bg-black text-white",
        fullscreen ? "min-h-svh px-6" : "min-h-64 rounded-3xl border border-white/10 px-6 py-12",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="relative flex w-full max-w-xs flex-col items-center text-center">
        <video
          className="h-36 w-36 object-contain sm:h-44 sm:w-44"
          src={VIDEO[video]}
          onPlaying={onVideoPlaying}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
        />
        <FinnosLogo className="mt-2 w-36" />
        <p className="mt-5 font-heading text-lg font-bold tracking-tight">{title}</p>
        <p className="mt-2 max-w-64 text-sm leading-relaxed text-white/60">{description}</p>
      </div>
    </div>
  );
}

export function FinnosPageLoading({ title, description }: Pick<FinnosLoadingProps, "title" | "description">) {
  return <FinnosLoading title={title} description={description} video="secondary" />;
}
