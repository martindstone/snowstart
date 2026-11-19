import { Anchor, List, Paper, Stack, Title } from "@mantine/core";
import Section from "../components/Section";
import { snNavLink, snRecordLink, useAppStore } from "../store/appStore";
import { derivePdInstanceUrl } from "../utils/pdUrl";

export default function VerifySection() {
  const updateSet = useAppStore((s) => s.updateSet);
  const snCreds = useAppStore((s) => s.snCreds);
  const integrationUser = useAppStore((s) => s.integrationUser);
  const pdConnection = useAppStore((s) => s.pdConnection);
  const pdUsers = useAppStore((s) => s.pdUsers);
  const pdServices = useAppStore((s) => s.pdServices);

  const sn = (target: string) => (snCreds ? snNavLink(snCreds.instanceUrl, target) : undefined);
  const pdBase = derivePdInstanceUrl(
    pdConnection?.user?.html_url ?? pdUsers.find((u) => u.html_url)?.html_url ?? pdServices.find((x) => x.html_url)?.html_url,
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
              <strong>Run the Integration Health Check</strong>
              {snCreds && (
                <>
                  {" "}
                  (<Anchor href={sn("x_pd_integration_integration_healthcheck.do")} target="_blank">open it</Anchor>)
                </>
              )}
              . First switch the application scope shown at the top right ("Application scope: Global") to{" "}
              <em>PagerDuty Incident Resolution Platform</em>. In the Global scope it can show a harmless "Not allowing
              update of property: connection_id" banner. Everything on the page should be Valid.
            </List.Item>
            <List.Item>
              Run the{" "}
              {snCreds ? (
                <Anchor href={sn("x_pd_integration_webhooks_healthcheck.do")} target="_blank">
                  Webhooks Health Check
                </Anchor>
              ) : (
                "Webhooks Health Check"
              )}{" "}
              to confirm PagerDuty can reach this instance.
            </List.Item>
            <List.Item>
              Confirm the five{" "}
              {snCreds ? (
                <Anchor
                  href={sn("sysauto_script_list.do?sysparm_query=nameSTARTSWITHPagerduty Webhook Events Processor")}
                  target="_blank"
                >
                  Pagerduty Webhook Events Processor
                </Anchor>
              ) : (
                "Pagerduty Webhook Events Processor"
              )}{" "}
              scheduled jobs are active and run as the integration user. SnowStart creates them because the app's own
              health check can't on newer ServiceNow releases.
            </List.Item>
            <List.Item>
              In PagerDuty, check the{" "}
              {pdBase ? (
                <Anchor href={`${pdBase}/incident-workflows/integrations`} target="_blank">
                  Workflow Integrations page
                </Anchor>
              ) : (
                "Workflow Integrations page (Automation → Incident Workflows)"
              )}{" "}
              for the <em>ServiceNow instance …</em> connection SnowStart created. It holds the integration user's
              password, so after changing that password, re-run <strong>Reset password</strong> in Setup or click
              Save on{" "}
              {snCreds ? (
                <Anchor href={sn("x_pd_integration_pd_settings_page.do")} target="_blank">
                  PagerDuty Settings
                </Anchor>
              ) : (
                "PagerDuty Settings"
              )}
              .
            </List.Item>
            <List.Item>
              Review the{" "}
              {snCreds ? (
                <Anchor href={sn("x_pd_integration_pagerduty_priority_list.do")} target="_blank">
                  priority mappings
                </Anchor>
              ) : (
                "priority mappings"
              )}
              {integrationUser && snCreds && (
                <>
                  {" "}
                  and the{" "}
                  <Anchor href={snRecordLink(snCreds.instanceUrl, "sys_user", integrationUser.snUser.sys_id)} target="_blank">
                    integration user
                  </Anchor>
                </>
              )}
              . The integration user's password is stored only in the app's encrypted settings; use Reset password in
              Setup to rotate it.
            </List.Item>
            <List.Item>
              {updateSet && snCreds ? (
                <>
                  Review the captured changes in{" "}
                  <Anchor href={snRecordLink(snCreds.instanceUrl, "sys_update_set", updateSet.sys_id)} target="_blank">
                    update set "{updateSet.name}"
                  </Anchor>{" "}
                  and promote it if these changes need to move to another instance.
                </>
              ) : (
                "Review the captured changes in the update set, and promote it if these changes need to move to another instance."
              )}
            </List.Item>
            <List.Item>
              In PagerDuty, make sure each linked service has its ServiceNow webhook configured pointing back to this
              instance
              {pdBase && (
                <>
                  {" "}
                  (start from the{" "}
                  <Anchor href={`${pdBase}/service-directory`} target="_blank">
                    service directory
                  </Anchor>
                  )
                </>
              )}
              . Linking a CI in the Link services tab creates its webhook subscription for you.
            </List.Item>
            <List.Item>
              Trigger a test: create a PagerDuty incident on a linked service, or update a ServiceNow incident's
              Assignment Group, and confirm it syncs in both directions.
            </List.Item>
          </List>
        </Paper>

      </Stack>
    </Section>
  );
}
