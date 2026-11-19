import EntityLinkSection from "../components/EntityLinkSection";
import { getAllTableRows, getTablePage, updateRecord } from "../api/servicenow";
import { getAllEscalationPolicies } from "../api/pagerduty";
import { SN_FIELDS, SN_TABLES } from "../config/schema";
import { currentPdCreds, currentSnCreds, snRecordLink, useAppStore } from "../store/appStore";
import type { SNGroup } from "../types/servicenow";

const SEARCH_LIMIT = 25;

export default function LinkEscalationsSection() {
  const logChange = useAppStore((s) => s.logChange);

  return (
    <EntityLinkSection
      tabView="escalations"
      title="Link existing PagerDuty escalation policies into ServiceNow"
      description={
        "Links each PagerDuty escalation policy to a ServiceNow Assignment Group, so incidents assigned to the group use that " +
        'policy. Exact name matches are suggested (ignoring the app\'s "SN:" prefix); search to pick a different group.'
      }
      sourceColumnLabel="PagerDuty escalation policy"
      targetColumnLabel="ServiceNow Assignment Group"
      targetPlaceholder="Search for a group"
      emptyMessage="No PagerDuty escalation policies found."
      loadSources={async () => {
        const policies = await getAllEscalationPolicies(currentPdCreds());
        return policies.map((p) => ({ id: p.id, name: p.name }));
      }}
      findExistingLinks={async (sources) => {
        const field = SN_FIELDS.sysUserGroup.pagerdutyEscalation;
        const linked = await getAllTableRows<Record<string, string>>(currentSnCreds(), SN_TABLES.sysUserGroup, `${field}ISNOTEMPTY`, [
          "sys_id",
          "name",
          field,
        ]);
        const known = new Set(sources.map((s) => s.id));
        const byPolicy: Record<string, { sysId: string; name: string; moreCount: number }> = {};
        for (const group of linked) {
          const id = group[field];
          if (!known.has(id)) continue;
          if (byPolicy[id]) byPolicy[id].moreCount++;
          else byPolicy[id] = { sysId: group.sys_id, name: group.name, moreCount: 0 };
        }
        return byPolicy;
      }}
      searchTargets={async (query) => {
        const groups = await getTablePage<SNGroup>(currentSnCreds(), SN_TABLES.sysUserGroup, {
          sysparm_query: `active=true^nameLIKE${query}`,
          sysparm_fields: "sys_id,name",
          sysparm_limit: SEARCH_LIMIT,
        });
        return groups.map((g) => ({ sysId: g.sys_id, name: g.name }));
      }}
      applyLink={async (source, target) => {
        const creds = currentSnCreds();
        await updateRecord(creds, SN_TABLES.sysUserGroup, target.sysId, {
          [SN_FIELDS.sysUserGroup.pagerdutyEscalation]: source.id,
        });
        logChange({
          system: "servicenow",
          table: SN_TABLES.sysUserGroup,
          recordId: target.sysId,
          description: `Linked PagerDuty escalation policy "${source.name}" to Assignment Group "${target.name}"`,
          link: snRecordLink(creds.instanceUrl, "sys_user_group", target.sysId),
        });
      }}
    />
  );
}
