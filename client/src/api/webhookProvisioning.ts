import { createRecord, getAllTableRows, getTablePage, snRequestOrThrow, updateRecord } from "./servicenow";
import { SN_FIELDS, SN_TABLES } from "../config/schema";
import type { SNCredentials } from "../types/servicenow";

/**
 * Provisions PagerDuty webhooks for linked CIs by running the app's own implementation of its
 * "Provision Webhook into PagerDuty" UI action — PagerDuty.searchWebhookByServiceId, then updateWebhookId when a
 * subscription already exists or provisionWebhook when it doesn't. Doing it through the app means the subscription
 * gets exactly the events, URL and Authorization header the app itself would give it, using the integration
 * credentials stored in the app's properties (SnowStart never needs to know the password).
 *
 * There is no REST endpoint for running server code, so — as with the cache flush and the password hash — a
 * one-shot scheduled script runs it as the connected admin and logs the outcome for SnowStart to read.
 */

const POLL_MS = 5000;
const TIMEOUT_MS = 4 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const utc = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

export interface CiNeedingWebhook {
  sysId: string;
  name: string;
  serviceId: string;
}

export interface WebhookOutcome {
  ci: string;
  action?: "created" | "reused";
  webhookId?: string;
  error?: string;
}

/** CIs linked to a PagerDuty service but without a webhook — exactly the UI action's own condition. */
export async function findCisNeedingWebhook(creds: SNCredentials): Promise<CiNeedingWebhook[]> {
  const svc = SN_FIELDS.cmdbCi.pagerdutyService;
  const wh = SN_FIELDS.cmdbCi.pagerdutyWebhook;
  const rows = await getAllTableRows<Record<string, string>>(creds, SN_TABLES.cmdbCi, `${svc}ISNOTEMPTY^${wh}ISEMPTY`, [
    "sys_id",
    "name",
    svc,
  ]);
  return rows.map((r) => ({ sysId: r.sys_id, name: r.name, serviceId: r[svc] }));
}

function buildScript(marker: string, items: { ci: string; svc: string }[]): string {
  return `
var items = ${JSON.stringify(items)};
items.forEach(function (it) {
  var out = { ci: it.ci };
  try {
    var gr = new GlideRecord('cmdb_ci');
    if (!gr.get(it.ci)) throw 'CI not found';
    var pd = new x_pd_integration.PagerDuty();
    var wid = pd.searchWebhookByServiceId(it.svc);
    if (wid) {
      pd.updateWebhookId(gr, it.svc, wid);
      out.action = 'reused';
    } else {
      wid = pd.provisionWebhook(gr, it.svc);
      out.action = 'created';
    }
    if (wid) out.webhookId = String(wid);
    else out.error = 'The app did not return a webhook id; see its logs for the PagerDuty error.';
  } catch (e) {
    out.error = String(e);
  }
  gs.info('${marker} ' + JSON.stringify(out));
});
gs.info('${marker} DONE');
`;
}

export async function provisionCiWebhooks(
  creds: SNCredentials,
  adminSysId: string,
  cis: CiNeedingWebhook[],
): Promise<WebhookOutcome[]> {
  const marker = `SNOWSTART_WEBHOOKS_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const job = await createRecord<{ sys_id: string }>(creds, "sysauto_script", {
    name: `SnowStart provision webhooks ${marker.slice(-6)}`,
    active: true,
    sys_scope: "global",
    run_type: "once",
    run_as: adminSysId,
    conditional: false,
    // Slightly in the past so the scheduler picks it up on its next poll.
    run_start: utc(new Date(Date.now() - 5000)),
    script: buildScript(
      marker,
      cis.map((c) => ({ ci: c.sysId, svc: c.serviceId })),
    ),
  });

  try {
    const deadline = Date.now() + TIMEOUT_MS;
    let lines: string[] = [];
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const hits = await getTablePage<{ message: string }>(creds, "syslog", {
        sysparm_query: `messageLIKE${marker}`,
        sysparm_fields: "message",
        sysparm_limit: cis.length + 5,
      });
      lines = hits.map((h) => h.message);
      if (lines.some((l) => l.includes(`${marker} DONE`))) break;
    }
    if (!lines.some((l) => l.includes(`${marker} DONE`))) {
      throw new Error("ServiceNow didn't finish provisioning webhooks within 4 minutes (is the scheduler running?).");
    }

    const outcomes: WebhookOutcome[] = [];
    for (const line of lines) {
      const json = line.slice(line.indexOf(marker) + marker.length).trim();
      if (json === "DONE") continue;
      try {
        outcomes.push(JSON.parse(json) as WebhookOutcome);
      } catch {
        /* a line that isn't ours */
      }
    }

    // When the app found an existing subscription it re-links it, but the Global-scope script can't mark the table row
    // as a v3 webhook (the UI action does, from inside the app's scope), so do that over the Table API.
    for (const o of outcomes.filter((x) => x.action === "reused" && !x.error)) {
      const rows = await getTablePage<{ sys_id: string; webhook_version: string }>(creds, SN_TABLES.pagerdutyWebhooks, {
        sysparm_query: `sn_entity_sys_id=${o.ci}`,
        sysparm_fields: "sys_id,webhook_version",
        sysparm_limit: 1,
      });
      if (rows[0] && rows[0].webhook_version !== "3") {
        await updateRecord(creds, SN_TABLES.pagerdutyWebhooks, rows[0].sys_id, { webhook_version: "3" }).catch(() => undefined);
      }
    }
    return outcomes;
  } finally {
    await snRequestOrThrow(creds, `/api/now/table/sysauto_script/${job.sys_id}`, { method: "DELETE" }).catch(() => undefined);
  }
}
