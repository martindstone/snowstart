import { checkViewStatus } from "./views";
import { isUpToDate, planPriorities } from "./priorities";
import type { SNCredentials } from "../types/servicenow";
import type { PDCredentials } from "../types/pagerduty";

/**
 * Whether the one-time configuration on the Configuration tab is in place: the PagerDuty fields on the forms and
 * lists, and a mapping for every PagerDuty priority. Read-only. Either half is "unknown" if it couldn't be checked,
 * which is never reported as a problem.
 */
export interface ConfigStatus {
  views: "ok" | "todo" | "unknown";
  /** Layouts still missing PagerDuty fields. */
  viewsMissing: number;
  priorities: "ok" | "todo" | "unknown";
  /** PagerDuty priorities without an up-to-date mapping. */
  prioritiesPending: number;
}

export async function checkConfiguration(sn: SNCredentials, pd: PDCredentials): Promise<ConfigStatus> {
  const status: ConfigStatus = { views: "unknown", viewsMissing: 0, priorities: "unknown", prioritiesPending: 0 };
  await Promise.all([
    checkViewStatus(sn)
      .then((entries) => {
        // An entry the installed app defines no fields for has nothing to add.
        status.viewsMissing = entries.reduce((n, e) => n + e.missing.length, 0);
        status.views = status.viewsMissing === 0 ? "ok" : "todo";
      })
      .catch(() => undefined),
    planPriorities(sn, pd)
      .then(({ rows }) => {
        status.prioritiesPending = rows.filter((r) => !isUpToDate(r)).length;
        status.priorities = status.prioritiesPending === 0 ? "ok" : "todo";
      })
      .catch(() => undefined),
  ]);
  return status;
}
