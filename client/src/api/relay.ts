// Same-origin by default: the Vite dev server proxies /api to the relay (see vite.config.ts), which also works
// through a tunnel. Set VITE_RELAY_URL to point at a relay elsewhere.
export const RELAY_BASE = import.meta.env?.VITE_RELAY_URL ?? "";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface RelayResponse<T> {
  status: number;
  data: T;
}

export class RelayRequestError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function callRelay<T>(
  endpoint: "servicenow" | "pagerduty",
  body: Record<string, unknown>,
): Promise<RelayResponse<T>> {
  const res = await fetch(`${RELAY_BASE}/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    // The relay itself rejected the request (bad host, bad method, etc.)
    const message = (payload && (payload as { error?: string }).error) || `Relay error (${res.status})`;
    throw new RelayRequestError(res.status, message, payload);
  }

  return payload as RelayResponse<T>;
}

export default callRelay;
