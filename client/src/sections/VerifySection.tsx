import { useEffect, useState, type ReactNode } from "react";
import { Alert, Anchor, List, Paper, Stack, Title } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import Section from "../components/Section";
import { getTablePage } from "../api/servicenow";
import { SN_FIELDS, SN_TABLES } from "../config/schema";
import { snNavLink, snRecordLink, useAppStore } from "../store/appStore";
import { derivePdInstanceUrl } from "../utils/pdUrl";

interface Named {
  sysId: string;
  name: string;
}

/** A linked CI and a linked assignment group to prefill the test incident with, when the instance has them. */
interface TestSample {
  ci?: Named;
  group?: Named;
}

export default function VerifySection() {
  const snCreds = useAppStore((s) => s.snCreds);
  const snAdminUser = useAppStore((s) => s.snAdminUser);
  const integrationUser = useAppStore((s) => s.integrationUser);
  const pdConnection = useAppStore((s) => s.pdConnection);
  const pdUsers = useAppStore((s) => s.pdUsers);
  const pdServices = useAppStore((s) => s.pdServices);
  const [sample, setSample] = useState<TestSample | null>(null);

  const sn = (target: string) => (snCreds ? snNavLink(snCreds.instanceUrl, target) : undefined);
  const pdBase = derivePdInstanceUrl(
    pdConnection?.user?.html_url ?? pdUsers.find((u) => u.html_url)?.html_url ?? pdServices.find((x) => x.html_url)?.html_url,
  );

  // The test incident needs something linked to PagerDuty to trigger anything, so look for a CI and a group that are.
  useEffect(() => {
    if (!snCreds) return;
    let cancelled = false;
    const first = (table: string, query: string) =>
      getTablePage<{ sys_id: string; name: string }>(snCreds, table, {
        sysparm_query: query,
        sysparm_fields: "sys_id,name",
        sysparm_limit: 1,
      })
        .then((rows): Named | undefined => (rows[0] ? { sysId: rows[0].sys_id, name: rows[0].name } : undefined))
        .catch(() => undefined);
    void Promise.all([
      first(SN_TABLES.cmdbCi, `${SN_FIELDS.cmdbCi.pagerdutyService}ISNOTEMPTY^operational_status!=6`),
      first(SN_TABLES.sysUserGroup, `${SN_FIELDS.sysUserGroup.pagerdutyEscalation}ISNOTEMPTY^active=true`),
    ]).then(([ci, group]) => {
      if (!cancelled) setSample({ ci, group });
    });
    return () => {
      cancelled = true;
    };
  }, [snCreds]);

  // The app only sends an incident to PagerDuty at priority 1 or 2 with a linked CI or group, so the form is prefilled
  // with impact and urgency 1 and whichever of those exist.
  const nothingLinked = !!sample && !sample.ci && !sample.group;
  const testIncidentLink = (() => {
    if (!snCreds || !sample || nothingLinked) return undefined;
    const fields = [
      "short_description=SnowStart test incident",
      "description=Created from SnowStart to test the PagerDuty integration.",
      "impact=1",
      "urgency=1",
      sample?.ci && `cmdb_ci=${sample.ci.sysId}`,
      sample?.group && `assignment_group=${sample.group.sysId}`,
      snAdminUser && `caller_id=${snAdminUser.sys_id}`,
    ].filter(Boolean);
    return sn(`incident.do?sys_id=-1&sysparm_query=${encodeURIComponent(fields.join("^"))}`);
  })();
  const sampleParts = [
    sample?.ci && `CI "${sample.ci.name}"`,
    sample?.group && `assignment group "${sample.group.name}"`,
  ].filter(Boolean);

  const link = (href: string | undefined, label: ReactNode) =>
    href ? (
      <Anchor href={href} target="_blank" inherit>
        {label}
      </Anchor>
    ) : (
      label
    );

  return (
    <Section
      title="Verify"
      description="Checks that confirm the integration works end to end. Most are one click away in ServiceNow or PagerDuty."
    >
      <Stack>
        <Paper withBorder p="md" radius="md">
          <Title order={5} mb="xs">
            Checks
          </Title>
          <List spacing="xs" size="sm">
            <List.Item>
              {link(sn("x_pd_integration_integration_healthcheck.do"), "Run the Integration Health Check")}. It
              starts running as soon as it opens. A red "Not allowing update of property: connection_id" banner will show at
              the top. That's expected and harmless, because the page opens in the Global scope. Everything else on the page
              should be Valid.
            </List.Item>
            <List.Item>
              {link(sn("x_pd_integration_webhooks_healthcheck.do"), "Run the Webhooks Health Check")} to
              confirm PagerDuty can reach this instance.
            </List.Item>
            <List.Item>
              Confirm the five{" "}
              {link(
                sn("sysauto_script_list.do?sysparm_query=nameSTARTSWITHPagerduty Webhook Events Processor"),
                "Pagerduty Webhook Events Processor",
              )}{" "}
              scheduled jobs are active and run as the integration user. SnowStart creates them because the app's own health
              check can't on newer ServiceNow releases.
            </List.Item>
            <List.Item>
              Review the {link(sn("x_pd_integration_pagerduty_priority_list.do"), "priority mappings")}
              {integrationUser && snCreds && (
                <>
                  {" "}
                  and the{" "}
                  {link(snRecordLink(snCreds.instanceUrl, "sys_user", integrationUser.snUser.sys_id), "integration user")}
                </>
              )}
              . The integration user's password is stored in the app's encrypted settings and in the PagerDuty connection
              SnowStart created. To rotate it, use Reset password in Setup, which updates both.
            </List.Item>
            <List.Item>
              In PagerDuty, open{" "}
              {link(pdBase && `${pdBase}/integrations/webhooks`, "Integrations → Generic Webhooks (v3)")} and check that each
              linked service has a webhook subscription pointing back to this instance. Linking a CI in the Link services tab
              creates it for you.
            </List.Item>
            <List.Item>
              Trigger a test:{" "}
              {nothingLinked ? (
                <Alert color="yellow" icon={<IconAlertTriangle size={16} />} mt={4} p="xs">
                  No CI or assignment group is linked to PagerDuty yet, so a ServiceNow incident has nothing to send. Link at
                  least one service in the Link services tab or one escalation policy in the Link escalations tab first.
                </Alert>
              ) : testIncidentLink ? (
                <>
                  {link(testIncidentLink, "open a new ServiceNow incident")} with {sampleParts.join(" and ")} filled in. Save it
                  and a PagerDuty incident should appear within a minute or so. Then acknowledge or resolve it in PagerDuty and
                  confirm the change comes back to ServiceNow.
                </>
              ) : (
                "create a ServiceNow incident at priority 1 or 2 with a linked CI or assignment group, and confirm a PagerDuty incident appears."
              )}
            </List.Item>
          </List>
        </Paper>
      </Stack>
    </Section>
  );
}
