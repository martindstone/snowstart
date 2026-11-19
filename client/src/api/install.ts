import { RELAY_BASE } from "./relay";
import { SNApiError, checkPdAppInstalled, getTablePage, snRequestOrThrow } from "./servicenow";
import type { SNCredentials, SNScope } from "../types/servicenow";

export interface UploadedUpdateSet {
  remoteUpdateSetId: string;
  name: string;
  scope: string;
  version: string;
}

export interface CicdProgress {
  status: string; // 0 pending, 1 running, 2 successful, 3 failed, 4 canceled
  status_label: string;
  status_message: string;
  error: string;
  percent_complete: number;
  has_preview_problem?: string;
  links?: { progress?: { id: string } };
}

export interface PreviewProblem {
  sys_id: string;
  type?: string;
  description?: string;
  status?: string;
  proposed_action?: string;
}

const POLL_MS = 4000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toBase64Utf8(value: string): string {
  let binary = "";
  new TextEncoder().encode(value).forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

/** Sends the XML to the relay, which replays the browser's session-based upload flow. */
export async function uploadUpdateSet(creds: SNCredentials, file: File): Promise<UploadedUpdateSet> {
  const res = await fetch(`${RELAY_BASE}/api/servicenow/upload-update-set`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "x-sn-instance": creds.instanceUrl,
      "x-sn-auth": toBase64Utf8(`${creds.username}:${creds.password}`),
      "x-filename": encodeURIComponent(file.name),
    },
    body: file,
  });
  const payload = (await res.json().catch(() => null)) as (UploadedUpdateSet & { error?: string }) | null;
  if (!res.ok || !payload) {
    throw new SNApiError(res.status, payload?.error ?? `Upload failed (${res.status})`);
  }
  return payload;
}

async function runCicd(
  creds: SNCredentials,
  path: string,
  label: string,
  onProgress?: (progress: CicdProgress) => void,
): Promise<CicdProgress> {
  const started = await snRequestOrThrow<{ result: CicdProgress }>(creds, path, { method: "POST", data: {} });
  const progressId = started.result.links?.progress?.id;
  if (!progressId) throw new SNApiError(502, `ServiceNow didn't return a progress id for the ${label}`);

  for (;;) {
    await sleep(POLL_MS);
    const { result } = await snRequestOrThrow<{ result: CicdProgress }>(creds, `/api/sn_cicd/progress/${progressId}`);
    onProgress?.(result);
    if (result.status === "2") return result;
    if (result.status === "3" || result.status === "4") {
      throw new SNApiError(500, result.error || result.status_message || `The ${label} ${result.status_label.toLowerCase()}`);
    }
  }
}

export async function getPreviewProblems(creds: SNCredentials, remoteUpdateSetId: string): Promise<PreviewProblem[]> {
  return getTablePage<PreviewProblem>(creds, "sys_update_preview_problem", {
    sysparm_query: `remote_update_set=${remoteUpdateSetId}`,
    sysparm_fields: "sys_id,type,description,status,proposed_action",
    sysparm_limit: 50,
  });
}

/** Previews the retrieved update set; resolves with any problems ServiceNow found. */
export async function previewUpdateSet(
  creds: SNCredentials,
  remoteUpdateSetId: string,
  onProgress?: (progress: CicdProgress) => void,
): Promise<PreviewProblem[]> {
  const result = await runCicd(creds, `/api/sn_cicd/update_set/preview/${remoteUpdateSetId}`, "preview", onProgress);
  return result.has_preview_problem === "true" ? getPreviewProblems(creds, remoteUpdateSetId) : [];
}

export interface CommitResult {
  scope: SNScope;
  /** Messages from the commit log when ServiceNow reported "completed with errors" but the app is installed. */
  warnings: string[];
}

async function getCommitErrors(creds: SNCredentials, remoteUpdateSetId: string): Promise<string[]> {
  // The commit log hangs off the local update set that the commit created (same name as the remote one).
  const remote = await getTablePage<{ name: string }>(creds, "sys_remote_update_set", {
    sysparm_query: `sys_id=${remoteUpdateSetId}`,
    sysparm_fields: "name",
  });
  if (!remote[0]) return [];
  const logs = await getTablePage<{ log: string }>(creds, "sys_update_set_log", {
    sysparm_query: `update_set.name=${remote[0].name}^status=Error`,
    sysparm_fields: "log",
    sysparm_limit: 25,
  });
  return logs.map((l) => l.log);
}

/**
 * Commits the previewed update set. ServiceNow reports "Failed" when even one
 * update in the set couldn't be applied (for the PagerDuty export that's a role
 * grant for a user who isn't on the instance) while the application is installed
 * and usable, so a failed commit only counts as a failure if the app didn't land.
 */
export async function commitUpdateSet(
  creds: SNCredentials,
  remoteUpdateSetId: string,
  onProgress?: (progress: CicdProgress) => void,
): Promise<CommitResult> {
  let commitError: SNApiError | null = null;
  try {
    await runCicd(creds, `/api/sn_cicd/update_set/commit/${remoteUpdateSetId}`, "commit", onProgress);
  } catch (e) {
    if (!(e instanceof SNApiError)) throw e;
    commitError = e;
  }
  const scope = await checkPdAppInstalled(creds);
  if (!scope) {
    throw commitError ?? new SNApiError(500, "The update set committed, but the PagerDuty app doesn't show up as installed.");
  }
  const state = await getTablePage<{ state: string }>(creds, "sys_remote_update_set", {
    sysparm_query: `sys_id=${remoteUpdateSetId}`,
    sysparm_fields: "state",
  });
  if (commitError && state[0]?.state !== "committed") throw commitError;
  return { scope, warnings: commitError ? await getCommitErrors(creds, remoteUpdateSetId) : [] };
}
