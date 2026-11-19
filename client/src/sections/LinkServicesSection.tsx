import EntityLinkSection from "../components/EntityLinkSection";
import WebhookProvisionPanel from "../components/WebhookProvisionPanel";
import { getAllTableRows, getTablePage, updateRecord } from "../api/servicenow";
import { getAllServices } from "../api/pagerduty";
import { SN_FIELDS, SN_TABLES } from "../config/schema";
import { currentPdCreds, currentSnCreds, snRecordLink, useAppStore } from "../store/appStore";
import type { SNCi } from "../types/servicenow";

const SEARCH_LIMIT = 25;
// operational_status=6 is "Retired" — the only status ServiceNow itself
// excludes from being set as an incident's Configuration Item (verified
// against this instance's task.cmdb_ci reference qualifier, which is a
// status check, not a CI-class/type restriction).
const ELIGIBLE_CI_QUERY = "operational_status!=6";

export default function LinkServicesSection() {
  const pdServices = useAppStore((s) => s.pdServices);
  const setPdServices = useAppStore((s) => s.setPdServices);
  const logChange = useAppStore((s) => s.logChange);

  return (
    <EntityLinkSection
      tabView="services"
      title="Link existing PagerDuty services into ServiceNow"
      description={
        "Links each PagerDuty service to a ServiceNow Configuration Item and creates the service's webhook in PagerDuty. " +
        'Exact name matches are suggested (ignoring the app\'s "SN:" prefix); search to pick a different CI.'
      }
      sourceColumnLabel="PagerDuty service"
      targetColumnLabel="ServiceNow Configuration Item"
      targetPlaceholder="Search for a CI"
      emptyMessage="No PagerDuty services found."
      loadSources={async () => {
        const services = pdServices.length > 0 ? pdServices : await getAllServices(currentPdCreds());
        if (pdServices.length === 0) setPdServices(services);
        return services.map((s) => ({ id: s.id, name: s.name }));
      }}
      findExistingLinks={async (sources) => {
        const field = SN_FIELDS.cmdbCi.pagerdutyService;
        const linked = await getAllTableRows<Record<string, string>>(
          currentSnCreds(),
          SN_TABLES.cmdbCi,
          `${field}ISNOTEMPTY`,
          ["sys_id", "name", field],
        );
        const known = new Set(sources.map((s) => s.id));
        const byService: Record<string, { sysId: string; name: string; moreCount: number }> = {};
        for (const ci of linked) {
          const id = ci[field];
          if (!known.has(id)) continue;
          if (byService[id]) byService[id].moreCount++;
          else byService[id] = { sysId: ci.sys_id, name: ci.name, moreCount: 0 };
        }
        return byService;
      }}
      searchTargets={async (query) => {
        const cis = await getTablePage<SNCi>(currentSnCreds(), SN_TABLES.cmdbCi, {
          sysparm_query: `${ELIGIBLE_CI_QUERY}^nameLIKE${query}`,
          sysparm_fields: "sys_id,name",
          sysparm_limit: SEARCH_LIMIT,
        });
        return cis.map((ci) => ({ sysId: ci.sys_id, name: ci.name }));
      }}
      extra={(ctx) => <WebhookProvisionPanel {...ctx} />}
      applyLink={async (source, target) => {
        const creds = currentSnCreds();
        await updateRecord(creds, SN_TABLES.cmdbCi, target.sysId, {
          [SN_FIELDS.cmdbCi.pagerdutyService]: source.id,
        });
        logChange({
          system: "servicenow",
          table: SN_TABLES.cmdbCi,
          recordId: target.sysId,
          description: `Linked PagerDuty service "${source.name}" to Configuration Item "${target.name}"`,
          link: snRecordLink(creds.instanceUrl, "cmdb_ci", target.sysId),
        });
      }}
    />
  );
}
