import { getTablePage } from "./servicenow";
import { SN_PROPERTIES } from "../config/schema";
import type { SNCredentials, SNUser } from "../types/servicenow";

/**
 * Reads what the PagerDuty app on this instance is already configured with, so steps can recognise an instance that
 * was set up before (by hand, by an earlier wizard run, or by someone else) and offer to keep it instead of redoing it.
 * Read-only; the two password properties are only reported as set/unset.
 */

const PROCESSOR_PREFIX = "Pagerduty Webhook Events Processor";
const MODE = "x_pd_integration.webhook_processing_mode";
const CONNECTION = "x_pd_integration.connection_id";

export interface ExistingConfig {
  instanceUrl: string;
  defaultUser: string;
  defaultService: string;
  autoProvisionUsers: boolean;
  mapping: string;
  apiKeySet: boolean;
  snAuthUser: string;
  snAuthUserPwdSet: boolean;
  processingMode: string;
  connectionId: string;
  /** The ServiceNow account named by the app's sn_auth_user property, when that account exists. */
  integrationUser: SNUser | null;
  /** Active "Pagerduty Webhook Events Processor" jobs and whether each runs as the integration user. */
  processors: { active: number; runningAsIntegrationUser: number };
  /** Base settings that mean "this instance has already been configured". */
  baseConfigured: boolean;
}

export async function detectExistingConfig(creds: SNCredentials): Promise<ExistingConfig> {
  const names = [
    SN_PROPERTIES.instanceUrl,
    SN_PROPERTIES.defaultUser,
    SN_PROPERTIES.defaultService,
    SN_PROPERTIES.autoProvisionUsers,
    SN_PROPERTIES.sn2pdMapping,
    SN_PROPERTIES.apiKey,
    SN_PROPERTIES.snAuthUser,
    SN_PROPERTIES.snAuthUserPwd,
    MODE,
    CONNECTION,
  ];
  const rows = await getTablePage<{ name: string; value: string }>(creds, "sys_properties", {
    sysparm_query: `nameIN${names.join(",")}`,
    sysparm_fields: "name,value",
    sysparm_limit: 50,
  });
  const p = new Map(rows.map((r) => [r.name, r.value ?? ""]));
  const get = (n: string) => p.get(n) ?? "";

  const snAuthUser = get(SN_PROPERTIES.snAuthUser);
  let integrationUser: SNUser | null = null;
  if (snAuthUser) {
    const users = await getTablePage<SNUser>(creds, "sys_user", {
      sysparm_query: `user_name=${snAuthUser}`,
      sysparm_fields:
        "sys_id,user_name,first_name,last_name,name,email,active,x_pd_integration_pagerduty_id,web_service_access_only,internal_integration_user",
      sysparm_limit: 1,
    });
    integrationUser = users[0] ?? null;
  }

  const jobs = await getTablePage<{ run_as: string | { value: string } }>(creds, "sysauto_script", {
    sysparm_query: `nameSTARTSWITH${PROCESSOR_PREFIX}^active=true`,
    sysparm_fields: "run_as",
    sysparm_limit: 20,
  });
  const runAs = (j: { run_as: string | { value: string } }) => (typeof j.run_as === "string" ? j.run_as : j.run_as?.value);

  const instanceUrl = get(SN_PROPERTIES.instanceUrl);
  const defaultUser = get(SN_PROPERTIES.defaultUser);
  const defaultService = get(SN_PROPERTIES.defaultService);
  const apiKeySet = !!get(SN_PROPERTIES.apiKey);
  return {
    instanceUrl,
    defaultUser,
    defaultService,
    autoProvisionUsers: get(SN_PROPERTIES.autoProvisionUsers) === "true",
    mapping: get(SN_PROPERTIES.sn2pdMapping),
    apiKeySet,
    snAuthUser,
    snAuthUserPwdSet: !!get(SN_PROPERTIES.snAuthUserPwd),
    processingMode: get(MODE),
    connectionId: get(CONNECTION),
    integrationUser,
    processors: {
      active: jobs.length,
      runningAsIntegrationUser: integrationUser ? jobs.filter((j) => runAs(j) === integrationUser!.sys_id).length : 0,
    },
    baseConfigured: !!(instanceUrl && defaultUser && defaultService && apiKeySet),
  };
}
