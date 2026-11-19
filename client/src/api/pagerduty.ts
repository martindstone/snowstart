import callRelay from "./relay";
import type { PDConnectionInfo, PDCredentials, PDService, PDUser, PDWebhookSubscription } from "../types/pagerduty";

interface PDRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  params?: Record<string, string | number | boolean>;
  data?: unknown;
}

export class PDApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function extractPDErrorMessage(data: unknown): string | undefined {
  if (data && typeof data === "object" && "error" in (data as Record<string, unknown>)) {
    const err = (data as { error?: unknown }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const e = err as { message?: string; errors?: string[] };
      if (typeof e.message === "string") return e.message;
      if (Array.isArray(e.errors)) return e.errors.join(", ");
    }
  }
  return undefined;
}

async function pdRequestOrThrow<T>(creds: PDCredentials, path: string, opts: PDRequestOptions = {}): Promise<T> {
  const { method = "GET", params, data } = opts;
  const { status, data: body } = await callRelay<T>("pagerduty", {
    apiToken: creds.apiToken,
    method,
    path,
    params,
    data,
  });
  if (status < 200 || status >= 300) {
    throw new PDApiError(status, extractPDErrorMessage(body) ?? `PagerDuty request failed (${status})`, body);
  }
  return body;
}

/**
 * A PD REST API v2 token can be scoped to a user (GET /users/me resolves an
 * identity) or to the account as a whole (no "current user" — /users/me
 * fails with "unable to determine the user's identity"). Try the
 * user-identity path first since it's more informative, and fall back to a
 * plain authenticated read that works for either token type.
 */
export async function testApiToken(creds: PDCredentials): Promise<PDConnectionInfo> {
  try {
    const data = await pdRequestOrThrow<{ user: PDUser }>(creds, "/users/me");
    return { tokenType: "user", user: data.user };
  } catch (e) {
    if (!(e instanceof PDApiError)) throw e;
    await pdRequestOrThrow(creds, "/abilities");
    return { tokenType: "account", user: null };
  }
}

async function paginate<T>(
  creds: PDCredentials,
  path: string,
  key: string,
  extraParams: Record<string, string | number | boolean> = {},
  pageSize = 100,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const data = await pdRequestOrThrow<Record<string, unknown>>(creds, path, {
      params: { ...extraParams, limit: pageSize, offset },
    });
    const page = (data[key] as T[] | undefined) ?? [];
    all.push(...page);
    if (!data.more || page.length === 0) break;
    offset += pageSize;
  }
  return all;
}

export async function getAllUsers(creds: PDCredentials): Promise<PDUser[]> {
  return paginate<PDUser>(creds, "/users", "users");
}

export async function getAllServices(creds: PDCredentials): Promise<PDService[]> {
  return paginate<PDService>(creds, "/services", "services");
}

export async function getAllEscalationPolicies(creds: PDCredentials): Promise<{ id: string; name: string }[]> {
  return paginate(creds, "/escalation_policies", "escalation_policies");
}

export async function getAllPriorities(creds: PDCredentials): Promise<{ id: string; name: string; order: number }[]> {
  // The endpoint is unpaginated; it returns every priority (an account may have none if the feature is off).
  const data = await pdRequestOrThrow<{ priorities?: { id: string; name: string; order: number }[] }>(creds, "/priorities");
  return data.priorities ?? [];
}

const WORKFLOW_CONNECTIONS = "/workflows/integrations/pagerduty.com:servicenow:integration:1/connections";

export interface PDWorkflowConnection {
  id: string;
  name?: string;
  service_url?: string;
  configuration?: Record<string, string>;
}

export async function listWorkflowConnections(creds: PDCredentials): Promise<PDWorkflowConnection[]> {
  const data = await pdRequestOrThrow<{ connections?: PDWorkflowConnection[] }>(creds, WORKFLOW_CONNECTIONS);
  return data.connections ?? [];
}

export async function createWorkflowConnection(creds: PDCredentials, body: unknown): Promise<PDWorkflowConnection> {
  const data = await pdRequestOrThrow<{ connection: PDWorkflowConnection }>(creds, WORKFLOW_CONNECTIONS, {
    method: "POST",
    data: body,
  });
  return data.connection;
}

export async function updateWorkflowConnection(creds: PDCredentials, id: string, body: unknown): Promise<void> {
  await pdRequestOrThrow(creds, `${WORKFLOW_CONNECTIONS}/${id}`, { method: "PATCH", data: body });
}

export async function deleteWorkflowConnection(creds: PDCredentials, id: string): Promise<void> {
  await pdRequestOrThrow(creds, `${WORKFLOW_CONNECTIONS}/${id}`, { method: "DELETE" });
}

export async function createUser(
  creds: PDCredentials,
  input: { name: string; email: string; role?: string },
): Promise<PDUser> {
  const data = await pdRequestOrThrow<{ user: PDUser }>(creds, "/users", {
    method: "POST",
    data: { user: { name: input.name, email: input.email, type: "user", role: input.role ?? "responder" } },
  });
  return data.user;
}

export async function getAllWebhookSubscriptions(creds: PDCredentials): Promise<PDWebhookSubscription[]> {
  return paginate<PDWebhookSubscription>(creds, "/webhook_subscriptions", "webhook_subscriptions");
}

export async function deleteWebhookSubscription(creds: PDCredentials, id: string): Promise<void> {
  await pdRequestOrThrow(creds, `/webhook_subscriptions/${id}`, { method: "DELETE" });
}

export async function createService(
  creds: PDCredentials,
  input: { name: string; description?: string; escalationPolicyId: string },
): Promise<PDService> {
  const data = await pdRequestOrThrow<{ service: PDService }>(creds, "/services", {
    method: "POST",
    data: {
      service: {
        type: "service",
        name: input.name,
        description: input.description,
        escalation_policy: { id: input.escalationPolicyId, type: "escalation_policy_reference" },
      },
    },
  });
  return data.service;
}
