// FINNOS wordmark: ink letters with the "O" drawn as a segmented donut chart,
// matching the brand logo. Replaces the former mascot entirely.

export function FinnosDonut({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      {/* segments, clockwise from 12 o'clock */}
      <path d="M20 2a18 18 0 0 1 18 18H28a8 8 0 0 0-8-8Z" fill="var(--brand-violet-light)" />
      <path d="M38 20a18 18 0 0 1-5.27 12.73l-7.07-7.07A8 8 0 0 0 28 20Z" fill="var(--brand-violet)" />
      <path d="M32.73 32.73A18 18 0 0 1 20 38V28a8 8 0 0 0 5.66-2.34Z" fill="var(--brand-violet-deep)" />
      <path d="M20 38A18 18 0 0 1 20 2v10a8 8 0 0 0 0 16Z" fill="var(--brand-violet)" />
    </svg>
  );
}

interface FinnosLogoProps {
  className?: string;
  /** Icon only — for compact spots like the mobile header or the favicon slot. */
  iconOnly?: boolean;
}

export function FinnosLogo({ className, iconOnly = false }: FinnosLogoProps) {
  if (iconOnly) {
    return (
      <span className={className} role="img" aria-label="FINNOS">
        <FinnosDonut className="h-full w-full" />
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`} role="img" aria-label="FINNOS">
      <span className="font-heading text-xl font-extrabold leading-none tracking-tight text-foreground">
        FINN
      </span>
      <FinnosDonut className="h-[0.95em] w-[0.95em] shrink-0 self-center" />
      <span className="font-heading text-xl font-extrabold leading-none tracking-tight text-foreground">
        S
      </span>
    </span>
  );
}
