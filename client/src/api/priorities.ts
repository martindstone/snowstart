import { createRecord, getAllTableRows, updateRecord } from "./servicenow";
import { getAllPriorities } from "./pagerduty";
import { mapPriorities, type LookupRow, type PriorityAssignment } from "../utils/priorityMapping";
import type { SNCredentials } from "../types/servicenow";
import type { PDCredentials } from "../types/pagerduty";

/**
 * Guide step on priority mappings: each PagerDuty priority gets an Impact/Urgency
 * pair on a row in the app's "PagerDuty Priority" table; ServiceNow's own priority
 * lookup rules then derive the incident priority from that pair.
 */
const PRIORITY_TABLE = "x_pd_integration_pagerduty_priority";

type RawLookup = { impact: string; urgency: string; priority: string; order: string; active: string };
type RawMapping = { sys_id: string; pagerduty_priority_id: string; pagerduty_priority: string; impact: string; urgency: string; priority: string };

export interface PriorityPlanRow extends PriorityAssignment {
  /** sys_id of the existing mapping row, if there is one. */
  existingId: string | null;
  /** What the row holds today ("" when empty), for display. */
  current: { impact: string; urgency: string; priority: string } | null;
}

export async function planPriorities(sn: SNCredentials, pd: PDCredentials): Promise<{ rows: PriorityPlanRow[]; pdCount: number }> {
  const [pdPriorities, lookupRaw, existing] = await Promise.all([
    getAllPriorities(pd),
    getAllTableRows<RawLookup>(sn, "dl_u_priority", "active=true", ["impact", "urgency", "priority", "order", "active"]),
    getAllTableRows<RawMapping>(sn, PRIORITY_TABLE, "", ["sys_id", "pagerduty_priority_id", "pagerduty_priority", "impact", "urgency", "priority"]),
  ]);
  const lookup: LookupRow[] = lookupRaw.map((r) => ({
    impact: Number(r.impact),
    urgency: Number(r.urgency),
    priority: Number(r.priority),
    order: Number(r.order) || 0,
  }));
  const assignments = mapPriorities(
    pdPriorities.map((p) => ({ id: p.id, name: p.name, order: p.order })),
    lookup,
  );
  const rows = assignments.map((a) => {
    const row = existing.find((e) => e.pagerduty_priority_id === a.pdPriorityId);
    return {
      ...a,
      existingId: row?.sys_id ?? null,
      current: row ? { impact: row.impact, urgency: row.urgency, priority: row.priority } : null,
    };
  });
  return { rows, pdCount: pdPriorities.length };
}

export function isUpToDate(row: PriorityPlanRow): boolean {
  return (
    !!row.current &&
    Number(row.current.impact) === row.impact &&
    Number(row.current.urgency) === row.urgency &&
    Number(row.current.priority) === row.snPriority
  );
}

/** Creates or updates a mapping row; returns its sys_id and whether it was newly created. */
export async function applyPriority(sn: SNCredentials, row: PriorityPlanRow): Promise<{ sysId: string; created: boolean }> {
  const values = { impact: row.impact, urgency: row.urgency, priority: row.snPriority };
  if (row.existingId) {
    await updateRecord(sn, PRIORITY_TABLE, row.existingId, values);
    return { sysId: row.existingId, created: false };
  }
  const created = await createRecord<{ sys_id: string }>(sn, PRIORITY_TABLE, {
    ...values,
    pagerduty_priority: row.pdPriorityName,
    pagerduty_priority_id: row.pdPriorityId,
  });
  return { sysId: created.sys_id, created: true };
}
