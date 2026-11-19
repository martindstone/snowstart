const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
// Relative path only: must start with a single "/" and contain no scheme or
// protocol-relative "//" prefix, which would let `new URL(path, base)` jump
// to an arbitrary host.
const SAFE_PATH = /^\/[A-Za-z0-9_\-./:]*$/;

export class RelayError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ParsedRelayBody {
  method: string;
  path: string;
  params?: Record<string, unknown>;
  data?: unknown;
}

export function validateRelayBody(body: unknown): ParsedRelayBody {
  const b = (body ?? {}) as Record<string, unknown>;
  const method = String(b.method ?? "").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new RelayError(400, `Method not allowed: ${String(b.method)}`);
  }
  const path = String(b.path ?? "");
  if (path.startsWith("//") || !SAFE_PATH.test(path)) {
    throw new RelayError(400, 'path must be a relative path starting with a single "/"');
  }
  return {
    method,
    path,
    params: b.params as Record<string, unknown> | undefined,
    data: b.data,
  };
}

/** Extra hosts or domain suffixes to allow, from --allow-host / SNOWSTART_ALLOW_HOSTS (comma-separated). */
function extraAllowedHosts(): string[] {
  return (process.env.SNOWSTART_ALLOW_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The relay forwards a user's ServiceNow credentials, so it only talks to ServiceNow hosts rather than any https URL a
 * request names. PDIs and hosted instances live under service-now.com; anything else must be allowed explicitly.
 */
function isAllowedInstanceHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.endsWith(".service-now.com")) return true;
  return extraAllowedHosts().some((allowed) => host === allowed || host.endsWith(`.${allowed.replace(/^\./, "")}`));
}

export function validateInstanceUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw) {
    throw new RelayError(400, "instanceUrl is required");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RelayError(400, "instanceUrl is not a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new RelayError(400, "instanceUrl must use https");
  }
  if (!isAllowedInstanceHost(url.hostname)) {
    throw new RelayError(
      400,
      `${url.hostname} isn't a ServiceNow host this relay will talk to (allowed: *.service-now.com${extraAllowedHosts().map((h) => `, ${h}`).join("")}). For a custom domain, start it with --allow-host ${url.hostname}.`,
    );
  }
  return `${url.protocol}//${url.host}`;
}

export function buildUrl(base: string, path: string, params?: Record<string, unknown>): URL {
  const url = new URL(path, base);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url;
}

export interface RelayResult {
  status: number;
  data: unknown;
}

export async function forward(url: URL, init: RequestInit): Promise<RelayResult> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = text;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // leave as raw text (e.g. HTML error page from an unreachable instance)
    }
  } else {
    data = null;
  }
  return { status: res.status, data };
}

const RETRY_DELAYS_MS = [2000, 3000, 4000, 5000, 6000];

/**
 * An error page from something in front of ServiceNow (a load balancer, a hibernating or restarting instance) rather
 * than from ServiceNow itself: a 5xx whose body is HTML. ServiceNow's own errors always come back as JSON, so these
 * never reached the application and are worth retrying.
 */
export function isFrontEndError(result: RelayResult): boolean {
  return [500, 502, 503, 504].includes(result.status) && typeof result.data === "string" && /<html/i.test(result.data);
}

/** forward(), retried a few times while ServiceNow's front end is answering with an error page. */
export async function forwardWithRetry(url: URL, init: RequestInit): Promise<RelayResult> {
  let result = await forward(url, init);
  for (let i = 0; i < RETRY_DELAYS_MS.length && isFrontEndError(result); i++) {
    console.warn(`servicenow front end returned ${result.status} for ${init.method} ${url.pathname}; retrying (${i + 1}/${RETRY_DELAYS_MS.length})`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[i]));
    result = await forward(url, init);
  }
  if (isFrontEndError(result)) {
    result = {
      status: result.status,
      data: { error: { message: "ServiceNow's front end kept returning an error page — the instance may be waking up, restarting or overloaded. Try again in a minute." } },
    };
  }
  return result;
}
