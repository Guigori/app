import { cn } from "@/lib/utils";

const LOADING_VIDEO = "/brand/finnos-loading-secondary.mp4";

type FinnosLoadingProps = {
  title?: string;
  description?: string;
  fullscreen?: boolean;
  className?: string;
  onVideoEnded?: () => void;
};

export function FinnosLoading({
  title = "Carregando seus dados",
  description = "Estamos preparando sua visão financeira.",
  fullscreen = false,
  className,
  onVideoEnded,
}: FinnosLoadingProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden bg-black",
        fullscreen ? "min-h-svh px-6" : "min-h-64 rounded-3xl px-6 py-12",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <video
        className="block h-auto w-64 max-w-full object-contain sm:w-80"
        src={LOADING_VIDEO}
        onEnded={onVideoEnded}
        autoPlay
        muted
        loop={!fullscreen}
        playsInline
        preload="auto"
        aria-hidden="true"
      />
      <span className="sr-only">{title}. {description}</span>
    </div>
  );
}

export function FinnosPageLoading({ title, description }: Pick<FinnosLoadingProps, "title" | "description">) {
  return <FinnosLoading title={title} description={description} />;
}
