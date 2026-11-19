import { checkPdAppInstalled } from "./servicenow";
import { getTableAccess, type TableAccessState } from "./prepare";
import { detectExistingConfig, type ExistingConfig } from "./existingConfig";
import type { SNCredentials, SNScope } from "../types/servicenow";
import type { PDUser } from "../types/pagerduty";

/**
 * Live answer to "is this instance set up for the PagerDuty integration?", recomputed from ServiceNow rather than from
 * what this session happened to do. Setup cards read their status from it; the app lands on Setup or on the working
 * sections depending on it. Items form a chain: each is blocked until the one before it is done.
 */

export type ItemId = "access" | "install" | "defaults" | "integration";
export type ItemStatus = "ok" | "todo" | "blocked" | "warn";

export interface ReadinessItem {
  id: ItemId;
  label: string;
  status: ItemStatus;
  /** One line describing the current state, shown on the card header. */
  detail: string;
  /** Problems that stop an existing item from being fully OK (for "warn"). */
  issues: string[];
  /** Worth knowing, but nothing the app can fix on its own and not a reason to flag the item. */
  notes?: string[];
  /** For a blocked item: the label of the item it's waiting on. */
  blockedBy?: string;
}

export interface Readiness {
  items: ReadinessItem[];
  config: ExistingConfig;
  scope: SNScope | null;
  tableAccess: TableAccessState[];
  /** Something essential is missing, as opposed to merely worth a look — the app opens on Setup. */
  needsSetup: boolean;
  allOk: boolean;
}

export const ITEM_LABELS: Record<ItemId, string> = {
  access: "Table access",
  install: "PagerDuty app",
  defaults: "Defaults",
  integration: "Integration user",
};

/** Number of "Pagerduty Webhook Events Processor" jobs the app expects. */
const EXPECTED_PROCESSORS = 5;

export async function checkReadiness(creds: SNCredentials, pdUsers: PDUser[]): Promise<Readiness> {
  const [tableAccess, scope, config] = await Promise.all([
    getTableAccess(creds),
    checkPdAppInstalled(creds),
    detectExistingConfig(creds),
  ]);

  const items: ReadinessItem[] = [];

  // 1. Table access
  const lacking = tableAccess.filter((t) => t.missing.length > 0);
  items.push({
    id: "access",
    label: ITEM_LABELS.access,
    status: lacking.length === 0 ? "ok" : "todo",
    detail:
      lacking.length === 0
        ? `All ${tableAccess.length} tables allow the app`
        : `${lacking.length} of ${tableAccess.length} tables need Application Access changes`,
    issues: lacking.map((t) => `${t.table}: missing ${t.missing.join(", ")}`),
  });

  // 2. App installed
  items.push({
    id: "install",
    label: ITEM_LABELS.install,
    status: scope ? "ok" : lacking.length > 0 ? "blocked" : "todo",
    detail: scope ? `${scope.name} v${scope.version} (${scope.scope})` : "Not installed on this instance",
    issues: [],
    blockedBy: !scope && lacking.length > 0 ? ITEM_LABELS.access : undefined,
  });

  // 3. Defaults: default user + default service, plus the settings derived from the connections
  const defaultsDone = !!scope && config.baseConfigured;
  const defaultUser = pdUsers.find((u) => u.id === config.defaultUser);
  const defaultsIssues: string[] = [];
  if (scope && !config.defaultUser) defaultsIssues.push("No default PagerDuty user");
  if (scope && !config.defaultService) defaultsIssues.push("No default service");
  if (scope && !config.apiKeySet) defaultsIssues.push("No API key stored");
  if (scope && !config.instanceUrl) defaultsIssues.push("No PagerDuty instance URL");
  items.push({
    id: "defaults",
    label: ITEM_LABELS.defaults,
    status: !scope ? "blocked" : defaultsDone ? "ok" : "todo",
    detail: defaultsDone
      ? `Default user ${defaultUser ? defaultUser.name : config.defaultUser}, default service ${config.defaultService}`
      : scope
        ? defaultsIssues.join("; ")
        : "Needs the PagerDuty app",
    issues: defaultsIssues,
    blockedBy: !scope ? ITEM_LABELS.install : undefined,
  });

  // 4. Integration user
  const u = config.integrationUser;
  const integrationIssues: string[] = [];
  if (u) {
    if (u.active !== "true") integrationIssues.push("The account is inactive");
    if (config.defaultUser && u.x_pd_integration_pagerduty_id !== config.defaultUser) {
      integrationIssues.push("It isn't linked to the default PagerDuty user");
    } else if (defaultUser && u.email.toLowerCase() !== defaultUser.email.toLowerCase()) {
      integrationIssues.push("Its email differs from the default PagerDuty user's");
    }
    if (config.processors.active < EXPECTED_PROCESSORS || config.processors.runningAsIntegrationUser < config.processors.active) {
      integrationIssues.push("Async webhook processing isn't fully set up");
    }
    if (config.processingMode === "sync") integrationIssues.push("Webhook processing mode is synchronous");
  }
  const integrationNotes: string[] = [];
  if (u && !config.snAuthUserPwdSet) integrationNotes.push("The app has no stored password for this account — use Reset password");
  if (u && !config.connectionId) integrationNotes.push("No PagerDuty workflow connection is recorded — Reset password creates it");
  items.push({
    id: "integration",
    label: ITEM_LABELS.integration,
    status: !defaultsDone ? "blocked" : !u ? "todo" : integrationIssues.length > 0 ? "warn" : "ok",
    detail: !defaultsDone
      ? "Needs the defaults"
      : !u
        ? "No integration user yet"
        : integrationIssues.length > 0
          ? `${u.user_name}: ${integrationIssues[0]}${integrationIssues.length > 1 ? ` (+${integrationIssues.length - 1} more)` : ""}`
          : `${u.user_name}, linked to the default user`,
    issues: integrationIssues,
    notes: integrationNotes,
    blockedBy: !defaultsDone ? ITEM_LABELS.defaults : undefined,
  });

  return {
    items,
    config,
    scope,
    tableAccess,
    needsSetup: items.some((i) => i.status === "todo" || i.status === "blocked"),
    allOk: items.every((i) => i.status === "ok"),
  };
}
