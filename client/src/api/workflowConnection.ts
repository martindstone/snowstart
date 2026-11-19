import { getTablePage, setProperty } from "./servicenow";
import { createWorkflowConnection, listWorkflowConnections, updateWorkflowConnection } from "./pagerduty";
import type { SNCredentials } from "../types/servicenow";
import type { PDCredentials } from "../types/pagerduty";

/**
 * PagerDuty's "Workflow connection" (Incident Workflows → ServiceNow integration) holds the
 * integration user's credentials so PagerDuty can call back into ServiceNow: manual sync mode and the
 * "create ServiceNow incident" workflow action both use it. The app provisions it from its Settings
 * page Save and from the health check, but both bake in whatever password is stored at that moment.
 * This reproduces PagerDutyProvisioning.ensureWorkflowConnection (basic-auth mode) so SnowStart can
 * create or refresh it once the integration user's final password is known.
 */
const CONNECTION_ID_PROPERTY = "x_pd_integration.connection_id";

const readProperties = async (creds: SNCredentials, names: string[]): Promise<Record<string, string>> => {
  const rows = await getTablePage<{ name: string; value: string }>(creds, "sys_properties", {
    sysparm_query: `nameIN${names.join(",")}`,
    sysparm_fields: "name,value",
  });
  return Object.fromEntries(rows.map((r) => [r.name, r.value]));
};

export interface WorkflowConnectionResult {
  id: string;
  name: string;
  action: "created" | "updated";
}

export async function ensureWorkflowConnection(
  sn: SNCredentials,
  pd: PDCredentials,
  integrationUser: { userName: string; password: string },
): Promise<WorkflowConnectionResult> {
  const props = await readProperties(sn, [
    "glide.servlet.uri",
    "instance_name",
    "x_pd_integration.webhook_restapi",
    CONNECTION_ID_PROPERTY,
  ]);

  // glide.servlet.uri ends in "/", and the app concatenates the two without a separator.
  const base = props["glide.servlet.uri"] || `${sn.instanceUrl.replace(/\/+$/, "")}/`;
  const snUrl = base + (props["x_pd_integration.webhook_restapi"] || "api/x_pd_integration/pagerduty2sn");
  const name = `ServiceNow instance ${props.instance_name || new URL(sn.instanceUrl).hostname.split(".")[0]}`;

  const body = {
    connection: {
      health: { is_healthy: true },
      service_url: snUrl,
      name,
      configuration: {
        URL: snUrl,
        "ServiceNow User ID": integrationUser.userName,
        "ServiceNow OAuth Client ID": "",
      },
      secrets: {
        "ServiceNow User Password": integrationUser.password,
        "ServiceNow OAuth Client Secret": "",
      },
    },
    scopes: ["read", "write"],
  };

  // Same matching as the app: the stored id if it still points at this instance, else any connection
  // for this instance's webhook URL.
  const matches = (await listWorkflowConnections(pd)).filter((c) => (c.service_url ?? c.configuration?.URL ?? "").includes(snUrl));
  const current = props[CONNECTION_ID_PROPERTY];
  const existing = matches.find((c) => c.id === current) ?? matches[0];

  let id: string;
  let action: WorkflowConnectionResult["action"];
  if (existing) {
    await updateWorkflowConnection(pd, existing.id, body);
    id = existing.id;
    action = "updated";
  } else {
    id = (await createWorkflowConnection(pd, body)).id;
    action = "created";
  }
  if (id !== current) await setProperty(sn, CONNECTION_ID_PROPERTY, id);
  return { id, name, action };
}
