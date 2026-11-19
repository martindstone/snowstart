import { createRecord, getTablePage, setProperty, updateRecord } from "./servicenow";
import type { SNCredentials } from "../types/servicenow";

/**
 * The app's Integration Health Check normally creates the five "Pagerduty Webhook
 * Events Processor" scheduled jobs and flips webhook processing to async, but on
 * recent ServiceNow releases its scoped GlideRecord writes to sysauto_script are
 * refused by the cross-scope access policy. An admin can create the same records
 * through the Table API, so the wizard does it with no change to any access setting.
 * The health check then finds the jobs already in place and passes.
 */
const PROCESSORS = [
  { name: "Pagerduty Webhook Events Processor", queue: "pagerduty_webhook_queue" },
  { name: "Pagerduty Webhook Events Processor (1)", queue: "pagerduty_webhook_queue_1" },
  { name: "Pagerduty Webhook Events Processor (2)", queue: "pagerduty_webhook_queue_2" },
  { name: "Pagerduty Webhook Events Processor (3)", queue: "pagerduty_webhook_queue_3" },
  { name: "Pagerduty Webhook Events Processor (4)", queue: "pagerduty_webhook_queue_4" },
];

const MODE_PROPERTY = "x_pd_integration.webhook_processing_mode";

// Same script body the app itself writes.
const processorScript = (queue: string) =>
  [
    "/*** Changes made to this script are not supported by PagerDuty ***/",
    "try { ",
    `  GlideEventManager('${queue}').process();`,
    "} catch (e) {",
    `  gs.error("Error processing Pagerduty Webhook Events from '${queue}': {0}", e);`,
    "}",
  ].join("\n");

export interface ProcessorResult {
  name: string;
  action: "created" | "updated" | "unchanged";
  sysId: string;
}

export async function ensureWebhookProcessors(
  creds: SNCredentials,
  integrationUserSysId: string,
): Promise<{ jobs: ProcessorResult[]; modeChanged: boolean }> {
  const jobs: ProcessorResult[] = [];
  for (const { name, queue } of PROCESSORS) {
    const existing = await getTablePage<{ sys_id: string; run_as: string | { value: string } }>(creds, "sysauto_script", {
      sysparm_query: `name=${name}`,
      sysparm_fields: "sys_id,run_as",
      sysparm_limit: 1,
    });
    if (!existing[0]) {
      const created = await createRecord<{ sys_id: string }>(creds, "sysauto_script", {
        name,
        active: true,
        sys_scope: "global",
        conditional: false,
        run_type: "periodically",
        run_as: integrationUserSysId,
        // GlideDuration(5000) in the app: 5 seconds, stored as a duration from the epoch.
        run_period: "1970-01-01 00:00:05",
        script: processorScript(queue),
      });
      jobs.push({ name, action: "created", sysId: created.sys_id });
      continue;
    }
    const runAs = typeof existing[0].run_as === "string" ? existing[0].run_as : existing[0].run_as?.value;
    if (runAs !== integrationUserSysId) {
      await updateRecord(creds, "sysauto_script", existing[0].sys_id, { run_as: integrationUserSysId });
      jobs.push({ name, action: "updated", sysId: existing[0].sys_id });
    } else {
      jobs.push({ name, action: "unchanged", sysId: existing[0].sys_id });
    }
  }

  const mode = await getTablePage<{ value: string }>(creds, "sys_properties", {
    sysparm_query: `name=${MODE_PROPERTY}`,
    sysparm_fields: "value",
    sysparm_limit: 1,
  });
  const modeChanged = mode[0]?.value === "sync";
  if (modeChanged) await setProperty(creds, MODE_PROPERTY, "async_multi");
  return { jobs, modeChanged };
}
