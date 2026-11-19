import { getTablePage, updateRecord } from "./servicenow";
import type { SNCredentials } from "../types/servicenow";

/**
 * Guide step 1.1 ("ServiceNow Application Access Controls"): the PagerDuty
 * app runs in its own scope but reads and writes these global tables, so each
 * table's Application Access flags must allow it. Field names are the
 * sys_db_object columns behind the checkboxes on a table's Application Access
 * tab; the labels are the ones the guide uses.
 */
export const ACCESS_FLAG_LABELS = {
  read_access: "Can read",
  create_access: "Can create",
  update_access: "Can update",
  configuration_access: "Allow configuration",
} as const;

export type AccessFlag = keyof typeof ACCESS_FLAG_LABELS;

export const TABLE_ACCESS_REQUIREMENTS: { table: string; flags: AccessFlag[] }[] = [
  { table: "sys_user", flags: ["read_access", "create_access", "update_access", "configuration_access"] },
  { table: "sys_user_group", flags: ["read_access", "create_access", "update_access", "configuration_access"] },
  { table: "sys_user_grmember", flags: ["read_access", "create_access", "update_access", "configuration_access"] },
  // The guide lists no "Allow configuration" for this one.
  { table: "sysauto_script", flags: ["read_access", "create_access", "update_access"] },
];

export interface TableAccessState {
  table: string;
  sysId: string;
  required: AccessFlag[];
  missing: AccessFlag[];
}

type DbObjectRow = { sys_id: string; name: string } & Partial<Record<AccessFlag, string>>;

export async function getTableAccess(creds: SNCredentials): Promise<TableAccessState[]> {
  const rows = await getTablePage<DbObjectRow>(creds, "sys_db_object", {
    sysparm_query: `nameIN${TABLE_ACCESS_REQUIREMENTS.map((r) => r.table).join(",")}`,
    sysparm_fields: `sys_id,name,${Object.keys(ACCESS_FLAG_LABELS).join(",")}`,
  });
  return TABLE_ACCESS_REQUIREMENTS.map(({ table, flags }) => {
    const row = rows.find((r) => r.name === table);
    return {
      table,
      sysId: row?.sys_id ?? "",
      required: flags,
      // A table we can't find can't be fixed here; treat every flag as missing so it's visible.
      missing: row ? flags.filter((f) => row[f] !== "true") : flags,
    };
  });
}

export async function applyTableAccess(creds: SNCredentials, state: TableAccessState): Promise<void> {
  if (!state.sysId || state.missing.length === 0) return;
  await updateRecord(
    creds,
    "sys_db_object",
    state.sysId,
    Object.fromEntries(state.missing.map((flag) => [flag, true])),
  );
}
