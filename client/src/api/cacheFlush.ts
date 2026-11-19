import { createRecord, getTablePage, snRequestOrThrow } from "./servicenow";
import type { SNCredentials } from "../types/servicenow";

/**
 * Runs gs.invalidateCache() in the Global scope. PagerDuty's troubleshooting guide prescribes
 * this after the Application Access flags change (and after installing the app): ServiceNow's
 * permission cache can otherwise keep refusing the app's cross-scope writes, for example to
 * sysauto_script, with "refused due to the api's cross-scope access policy".
 *
 * There's no REST endpoint for it, so a one-shot scheduled script runs it (as the connected admin)
 * and logs a unique marker SnowStart waits for.
 */
const POLL_MS = 5000;
const TIMEOUT_MS = 3 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const utc = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

export async function flushServiceNowCache(creds: SNCredentials, adminSysId: string): Promise<void> {
  const marker = `SNOWSTART_CACHE_FLUSHED_${crypto.randomUUID()}`;
  const job = await createRecord<{ sys_id: string }>(creds, "sysauto_script", {
    name: `SnowStart flush cache ${marker.slice(-8)}`,
    active: true,
    sys_scope: "global",
    run_type: "once",
    run_as: adminSysId,
    conditional: false,
    // Slightly in the past so the scheduler picks it up on its next poll.
    run_start: utc(new Date(Date.now() - 5000)),
    script: `gs.invalidateCache();\ngs.info('${marker}');`,
  });
  try {
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const hits = await getTablePage<{ sys_id: string }>(creds, "syslog", {
        sysparm_query: `messageLIKE${marker}`,
        sysparm_fields: "sys_id",
        sysparm_limit: 1,
      });
      if (hits.length > 0) return;
    }
    throw new Error("ServiceNow didn't confirm the cache flush within 3 minutes (is the scheduler running?).");
  } finally {
    await snRequestOrThrow(creds, `/api/now/table/sysauto_script/${job.sys_id}`, { method: "DELETE" }).catch(() => undefined);
  }
}
