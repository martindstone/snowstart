import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";
import { Anchor, Badge, Group, List, Paper, ScrollArea, Stack, Table, Text, ThemeIcon, Title } from "@mantine/core";
import { IconCircleCheck } from "@tabler/icons-react";
import StepShell from "../components/StepShell";
import { snNavLink, snRecordLink, useWizardStore } from "../store/wizardStore";
import { derivePdInstanceUrl } from "../utils/pdUrl";

function celebrate() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const shared = { spread: 55, startVelocity: 45, origin: { y: 0.6 } };
  confetti({ ...shared, particleCount: 80, angle: 60, origin: { x: 0, y: 0.6 } });
  confetti({ ...shared, particleCount: 80, angle: 120, origin: { x: 1, y: 0.6 } });
}

export default function Step10Summary() {
  const changeLog = useWizardStore((s) => s.changeLog);
  const updateSet = useWizardStore((s) => s.updateSet);
  const snCreds = useWizardStore((s) => s.snCreds);
  const integrationUser = useWizardStore((s) => s.integrationUser);
  const pdConnection = useWizardStore((s) => s.pdConnection);
  const pdUsers = useWizardStore((s) => s.pdUsers);
  const pdServices = useWizardStore((s) => s.pdServices);
  const fired = useRef(false);

  const sn = (target: string) => (snCreds ? snNavLink(snCreds.instanceUrl, target) : undefined);
  const pdBase = derivePdInstanceUrl(
    pdConnection?.user?.html_url ?? pdUsers.find((u) => u.html_url)?.html_url ?? pdServices.find((x) => x.html_url)?.html_url,
  );

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    celebrate();
  }, []);

  return (
    <StepShell title="Setup complete" hideNext>
      <Stack>
        <Paper withBorder p="md" radius="md" bg="var(--mantine-color-green-light)">
          <Group gap="sm" wrap="nowrap" align="flex-start">
            <ThemeIcon color="green" size={36} radius="xl">
              <IconCircleCheck size={22} />
            </ThemeIcon>
            <div>
              <Title order={4}>ServiceNow is configured and ready to use</Title>
              <Text size="sm" c="dimmed" mt={2}>
                The PagerDuty app is installed and configured: table access, base settings, views and priority mappings,
                the integration user (with its async webhook processors and PagerDuty workflow connection), and any
                users, services and escalation policies you linked are all live. The checks below confirm it end to end.
              </Text>
            </div>
          </Group>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Title order={5} mb="xs">
            Suggested next steps
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
              scheduled jobs are active and run as the integration user. The wizard created them because the app's own
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
              for the <em>ServiceNow instance …</em> connection the wizard created. It holds the integration user's
              password, so after changing that password, re-run <strong>Reset password</strong> in this wizard or click
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
              this wizard to rotate it.
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
              . This wizard configures the ServiceNow side of the connection; per-service PagerDuty webhook
              subscriptions aren't created automatically.
            </List.Item>
            <List.Item>
              Trigger a test: create a PagerDuty incident on a linked service, or update a ServiceNow incident's
              Assignment Group, and confirm it syncs in both directions.
            </List.Item>
            <List.Item>You can re-run this wizard any time to link more users, services, or escalation policies.</List.Item>
          </List>
        </Paper>

        {changeLog.length === 0 ? (
          <Text c="dimmed">No changes were made this session.</Text>
        ) : (
          <ScrollArea h={420}>
            <Table stickyHeader striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Time</Table.Th>
                  <Table.Th>System</Table.Th>
                  <Table.Th>Description</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {changeLog.map((entry) => (
                  <Table.Tr key={entry.id}>
                    <Table.Td>{new Date(entry.timestamp).toLocaleTimeString()}</Table.Td>
                    <Table.Td>
                      <Badge color={entry.system === "servicenow" ? "blue" : "grape"}>{entry.system}</Badge>
                    </Table.Td>
                    <Table.Td>
                      {entry.link ? (
                        <Anchor href={entry.link} target="_blank">
                          {entry.description}
                        </Anchor>
                      ) : (
                        entry.description
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Stack>
    </StepShell>
  );
}
