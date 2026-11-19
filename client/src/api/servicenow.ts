import callRelay from "./relay";
import { PD_APP_SCOPE, PD_APP_SYS_ID } from "../config/schema";
import type { SNCredentials, SNProperty, SNScope, SNTableResult, SNUser } from "../types/servicenow";

interface SNRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  params?: Record<string, string | number | boolean>;
  data?: unknown;
}

export class SNApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function extractSNErrorMessage(data: unknown): string | undefined {
  if (data && typeof data === "object" && "error" in (data as Record<string, unknown>)) {
    const err = (data as { error?: { message?: string } }).error;
    if (err && typeof err === "object" && typeof err.message === "string") return err.message;
  }
  return undefined;
}

function unwrapResult<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "result" in (payload as Record<string, unknown>)) {
    return (payload as { result: T }).result;
  }
  return payload as T;
}

export async function snRequestOrThrow<T>(creds: SNCredentials, path: string, opts: SNRequestOptions = {}): Promise<T> {
  const { method = "GET", params, data } = opts;
  const { status, data: body } = await callRelay<T>("servicenow", {
    instanceUrl: creds.instanceUrl,
    username: creds.username,
    password: creds.password,
    method,
    path,
    params,
    data,
  });
  // A sleeping PDI answers every URL with a 200 HTML "Instance Hibernating" page.
  if (typeof body === "string" && /hibernat/i.test(body)) {
    throw new SNApiError(
      503,
      "This instance is hibernating. Wake it from developer.servicenow.com (it can take a few minutes), then retry.",
    );
  }
  if (status === 401) {
    throw new SNApiError(
      401,
      "ServiceNow rejected the credentials (401). Check the username/password, that the account isn't locked out, and that it has the snc_basic_auth_api_access and snc_platform_rest_api_access roles.",
      body,
    );
  }
  if (status === 403 && !extractSNErrorMessage(body)) {
    throw new SNApiError(403, "ServiceNow denied access (403) — the account is missing a role this action needs.", body);
  }
  if (status < 200 || status >= 300) {
    throw new SNApiError(status, extractSNErrorMessage(body) ?? `ServiceNow request failed (${status})`, body);
  }
  return body;
}

export async function getTablePage<T>(
  creds: SNCredentials,
  table: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T[]> {
  const result = await snRequestOrThrow<SNTableResult<T>>(creds, `/api/now/table/${table}`, { params });
  return result.result ?? [];
}

/** Pages through sysparm_offset until a short page is returned. */
export async function getAllTableRows<T>(
  creds: SNCredentials,
  table: string,
  query: string,
  fields?: string[],
  pageSize = 200,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const params: Record<string, string | number> = {
      sysparm_query: query,
      sysparm_limit: pageSize,
      sysparm_offset: offset,
    };
    if (fields?.length) params.sysparm_fields = fields.join(",");
    const page = await getTablePage<T>(creds, table, params);
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

export async function createRecord<T>(creds: SNCredentials, table: string, data: Record<string, unknown>): Promise<T> {
  const payload = await snRequestOrThrow<unknown>(creds, `/api/now/table/${table}`, { method: "POST", data });
  return unwrapResult<T>(payload);
}

export async function updateRecord<T>(
  creds: SNCredentials,
  table: string,
  sysId: string,
  data: Record<string, unknown>,
): Promise<T> {
  const payload = await snRequestOrThrow<unknown>(creds, `/api/now/table/${table}/${sysId}`, { method: "PATCH", data });
  return unwrapResult<T>(payload);
}

export async function testCredentials(creds: SNCredentials): Promise<SNUser> {
  const byUsername = await getTablePage<SNUser>(creds, "sys_user", {
    sysparm_query: `user_name=${creds.username}`,
    sysparm_limit: 1,
    sysparm_fields: "sys_id,user_name,first_name,last_name,name,email,active",
  });
  if (byUsername[0]) return byUsername[0];

  // Credentials might be valid for a user whose user_name doesn't match what
  // was typed (e.g. LDAP-mapped accounts) — a plain limited read still proves auth works.
  const anyUser = await getTablePage<SNUser>(creds, "sys_user", { sysparm_limit: 1 });
  if (anyUser[0]) return anyUser[0];
  throw new SNApiError(404, "Authenticated, but could not read any sys_user records to confirm identity.");
}

export async function checkPdAppInstalled(creds: SNCredentials): Promise<SNScope | null> {
  const rows = await getTablePage<SNScope>(creds, "sys_scope", {
    sysparm_query: `sys_id=${PD_APP_SYS_ID}^ORscope=${PD_APP_SCOPE}^ORscope=${PD_APP_SCOPE}_dev`,
    sysparm_fields: "sys_id,scope,name,version,short_description",
    sysparm_limit: 1,
  });
  return rows[0] ?? null;
}

export async function setProperty(creds: SNCredentials, name: string, value: string): Promise<void> {
  const existing = await getTablePage<SNProperty>(creds, "sys_properties", {
    sysparm_query: `name=${name}`,
    sysparm_fields: "sys_id,name,value",
    sysparm_limit: 1,
  });
  if (existing[0]?.sys_id) {
    await updateRecord(creds, "sys_properties", existing[0].sys_id, { value });
  } else {
    await createRecord(creds, "sys_properties", { name, value, type: "string" });
  }
}

export async function setCurrentUpdateSet(creds: SNCredentials, adminSysId: string, updateSetSysId: string): Promise<void> {
  const existing = await getTablePage<{ sys_id: string }>(creds, "sys_user_preference", {
    sysparm_query: `user=${adminSysId}^name=sys_update_set`,
    sysparm_fields: "sys_id",
    sysparm_limit: 1,
  });
  if (existing[0]?.sys_id) {
    await updateRecord(creds, "sys_user_preference", existing[0].sys_id, { value: updateSetSysId });
  } else {
    await createRecord(creds, "sys_user_preference", { user: adminSysId, name: "sys_update_set", value: updateSetSysId });
  }
}

export async function getRoleSysId(creds: SNCredentials, roleName: string): Promise<string | null> {
  const rows = await getTablePage<{ sys_id: string }>(creds, "sys_user_role", {
    sysparm_query: `name=${roleName}`,
    sysparm_fields: "sys_id",
    sysparm_limit: 1,
  });
  return rows[0]?.sys_id ?? null;
}

export async function assignRole(creds: SNCredentials, userSysId: string, roleSysId: string): Promise<void> {
  await createRecord(creds, "sys_user_has_role", { user: userSysId, role: roleSysId });
}

export async function hasRole(creds: SNCredentials, userSysId: string, roleSysId: string): Promise<boolean> {
  const rows = await getTablePage<{ sys_id: string }>(creds, "sys_user_has_role", {
    sysparm_query: `user=${userSysId}^role=${roleSysId}`,
    sysparm_fields: "sys_id",
    sysparm_limit: 1,
  });
  return rows.length > 0;
}
