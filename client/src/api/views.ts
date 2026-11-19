import { createRecord, getTablePage } from "./servicenow";
import type { SNCredentials } from "../types/servicenow";

/**
 * Guide step 1.3 ("Add PagerDuty Fields to Views"). Layouts live in four core
 * tables, all keyed to the Default view:
 *   list columns  sys_ui_list (name = table)          → sys_ui_list_element (list_id)
 *   form fields   sys_ui_section (name = table)       → sys_ui_element (sys_ui_section)
 * Only fields the installed app build actually defines are added, and fields
 * already on a layout are left alone, so re-running is harmless.
 */

export interface ViewPlanEntry {
  key: string;
  label: string;
  /** The table that defines the fields (CI fields live on cmdb_ci, shared by every class). */
  fieldTable: string;
  /** Candidate fields, in the order they should appear. Missing ones are skipped. */
  fields: string[];
  /** Tables whose list/form layouts get the fields. */
  layoutTables: string[];
}

export const VIEW_PLAN: ViewPlanEntry[] = [
  {
    key: "users",
    label: "Users",
    fieldTable: "sys_user",
    fields: ["x_pd_integration_pagerduty_id"],
    layoutTables: ["sys_user"],
  },
  {
    key: "groups",
    label: "Assignment groups",
    fieldTable: "sys_user_group",
    fields: [
      "x_pd_integration_pagerduty_service",
      "x_pd_integration_pagerduty_escalation",
      "x_pd_integration_pagerduty_team",
      "x_pd_integration_pagerduty_schedule",
      "x_pd_integration_pagerduty_webhook",
    ],
    layoutTables: ["sys_user_group"],
  },
  {
    key: "cis",
    label: "Configuration items",
    fieldTable: "cmdb_ci",
    fields: [
      "x_pd_integration_pagerduty_service",
      "x_pd_integration_pagerduty_webhook",
      "x_pd_integration_pagerduty_change_event_token",
    ],
    // A class with its own form layout (e.g. cmdb_ci_appl) doesn't inherit fields added to cmdb_ci's.
    layoutTables: ["cmdb_ci", "cmdb_ci_appl"],
  },
  {
    key: "incidents",
    label: "Incidents",
    fieldTable: "incident",
    fields: ["x_pd_integration_incident"],
    layoutTables: ["incident"],
  },
];

export const COMMON_CI_CLASSES = [
  "cmdb_ci",
  "cmdb_ci_appl",
  "cmdb_ci_server",
  "cmdb_ci_computer",
  "cmdb_ci_service",
  "cmdb_ci_business_app",
  "cmdb_ci_database",
  "cmdb_ci_netgear",
];

export interface LayoutResult {
  table: string;
  layout: "list" | "form";
  added: string[];
  alreadyThere: string[];
  /** Why nothing could be done for this layout (no layout of its own, so it inherits the parent's). */
  note?: string;
}

const DEFAULT_VIEW = "Default view";

async function existingFields(creds: SNCredentials, fieldTable: string, candidates: string[]): Promise<string[]> {
  const rows = await getTablePage<{ element: string }>(creds, "sys_dictionary", {
    sysparm_query: `name=${fieldTable}^elementIN${candidates.join(",")}`,
    sysparm_fields: "element",
  });
  const present = new Set(rows.map((r) => r.element));
  return candidates.filter((c) => present.has(c));
}

export async function addListColumns(creds: SNCredentials, table: string, fields: string[]): Promise<LayoutResult> {
  const lists = await getTablePage<{ sys_id: string }>(creds, "sys_ui_list", {
    sysparm_query: `name=${table}^view=${DEFAULT_VIEW}^relationshipISEMPTY^sys_userISEMPTY^parentISEMPTY`,
    sysparm_fields: "sys_id",
    sysparm_limit: 1,
  });
  if (!lists[0]) {
    return { table, layout: "list", added: [], alreadyThere: [], note: "No list layout of its own — it inherits its parent's." };
  }
  const columns = await getTablePage<{ element: string; position: string }>(creds, "sys_ui_list_element", {
    sysparm_query: `list_id=${lists[0].sys_id}`,
    sysparm_fields: "element,position",
    sysparm_limit: 500,
  });
  const have = new Set(columns.map((c) => c.element));
  let position = Math.max(-1, ...columns.map((c) => Number(c.position) || 0)) + 1;
  const added: string[] = [];
  for (const field of fields) {
    if (have.has(field)) continue;
    await createRecord(creds, "sys_ui_list_element", { list_id: lists[0].sys_id, element: field, position });
    position++;
    added.push(field);
  }
  return { table, layout: "list", added, alreadyThere: fields.filter((f) => have.has(f)) };
}

export async function addFormFields(creds: SNCredentials, table: string, fields: string[]): Promise<LayoutResult> {
  const sections = await getTablePage<{ sys_id: string }>(creds, "sys_ui_section", {
    sysparm_query: `name=${table}^view=${DEFAULT_VIEW}^captionISEMPTY`,
    sysparm_fields: "sys_id",
    sysparm_limit: 1,
  });
  if (!sections[0]) {
    return { table, layout: "form", added: [], alreadyThere: [], note: "No form layout of its own — it inherits its parent's." };
  }
  const elements = await getTablePage<{ element: string; position: string }>(creds, "sys_ui_element", {
    sysparm_query: `sys_ui_section=${sections[0].sys_id}`,
    sysparm_fields: "element,position",
    sysparm_limit: 500,
  });
  const have = new Set(elements.map((e) => e.element));
  let position = Math.max(-1, ...elements.map((e) => Number(e.position) || 0)) + 1;
  const added: string[] = [];
  for (const field of fields) {
    if (have.has(field)) continue;
    await createRecord(creds, "sys_ui_element", { sys_ui_section: sections[0].sys_id, element: field, position });
    position++;
    added.push(field);
  }
  return { table, layout: "form", added, alreadyThere: fields.filter((f) => have.has(f)) };
}

/** Applies one plan entry; `formTables` overrides which tables get the form fields (the CI class picker). */
export async function applyViewPlan(
  creds: SNCredentials,
  entry: ViewPlanEntry,
  formTables: string[] = entry.layoutTables,
): Promise<{ fields: string[]; results: LayoutResult[] }> {
  const fields = await existingFields(creds, entry.fieldTable, entry.fields);
  if (fields.length === 0) return { fields, results: [] };
  const results: LayoutResult[] = [];
  // List columns are shared by every class, so only the base table's list is touched.
  results.push(await addListColumns(creds, entry.layoutTables[0], fields));
  for (const table of formTables) results.push(await addFormFields(creds, table, fields));
  return { fields, results };
}

export interface ViewStatus {
  key: string;
  label: string;
  /** Fields of this plan entry the installed app actually defines. */
  fields: string[];
  /** Layouts that lack some of those fields. Empty means the entry is complete. */
  missing: { table: string; layout: "list" | "form"; fields: string[] }[];
}

/**
 * Read-only counterpart of applyViewPlan: which layouts are still missing which of the app's fields. A layout with no
 * layout of its own (it inherits its parent's) counts as complete.
 */
export async function checkViewStatus(creds: SNCredentials, formTablesByKey: Record<string, string[]> = {}): Promise<ViewStatus[]> {
  const out: ViewStatus[] = [];
  for (const entry of VIEW_PLAN) {
    const fields = await existingFields(creds, entry.fieldTable, entry.fields);
    const missing: ViewStatus["missing"] = [];
    if (fields.length > 0) {
      const listTable = entry.layoutTables[0];
      const lists = await getTablePage<{ sys_id: string }>(creds, "sys_ui_list", {
        sysparm_query: `name=${listTable}^view=${DEFAULT_VIEW}^relationshipISEMPTY^sys_userISEMPTY^parentISEMPTY`,
        sysparm_fields: "sys_id",
        sysparm_limit: 1,
      });
      if (lists[0]) {
        const columns = await getTablePage<{ element: string }>(creds, "sys_ui_list_element", {
          sysparm_query: `list_id=${lists[0].sys_id}`,
          sysparm_fields: "element",
          sysparm_limit: 500,
        });
        const have = new Set(columns.map((c) => c.element));
        const lacking = fields.filter((f) => !have.has(f));
        if (lacking.length) missing.push({ table: listTable, layout: "list", fields: lacking });
      }
      for (const table of formTablesByKey[entry.key] ?? entry.layoutTables) {
        const sections = await getTablePage<{ sys_id: string }>(creds, "sys_ui_section", {
          sysparm_query: `name=${table}^view=${DEFAULT_VIEW}^captionISEMPTY`,
          sysparm_fields: "sys_id",
          sysparm_limit: 1,
        });
        if (!sections[0]) continue;
        const elements = await getTablePage<{ element: string }>(creds, "sys_ui_element", {
          sysparm_query: `sys_ui_section=${sections[0].sys_id}`,
          sysparm_fields: "element",
          sysparm_limit: 500,
        });
        const have = new Set(elements.map((e) => e.element));
        const lacking = fields.filter((f) => !have.has(f));
        if (lacking.length) missing.push({ table, layout: "form", fields: lacking });
      }
    }
    out.push({ key: entry.key, label: entry.label, fields, missing });
  }
  return out;
}
