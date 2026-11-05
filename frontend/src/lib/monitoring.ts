/** Error monitoring (Sentry) for the app. Off unless VITE_SENTRY_DSN is set, and the SDK is
 *  only downloaded when it is on. Never sends financial data: no request bodies or query
 *  strings, no user identity, no breadcrumb payloads, no session replay or tracing. */
type SentryEvent = {
  request?: { url?: string; data?: unknown; query_string?: unknown; cookies?: unknown; headers?: Record<string, string> };
  user?: unknown;
  extra?: unknown;
  breadcrumbs?: Array<{ category?: string; data?: unknown; message?: string }>;
};

export function scrubEvent<T extends SentryEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.headers;
    if (event.request.url) event.request.url = event.request.url.split("?")[0];
  }
  delete event.user;
  delete event.extra;
  event.breadcrumbs = (event.breadcrumbs ?? [])
    .filter((b) => b.category !== "console")
    .map(({ data: _data, ...rest }) => (rest.message ? { ...rest, message: rest.message.split("?")[0] } : rest));
  return event;
}

export function initMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  void import("@sentry/react").then((Sentry) => {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      release: (import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA as string | undefined) || undefined,
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      beforeSend: (event) => scrubEvent(event as SentryEvent) as typeof event,
    });
  }).catch(() => undefined);
}
