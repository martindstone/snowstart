import { Alert, List, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import StepShell from "../components/StepShell";

export default function Step0Welcome() {
  return (
    <StepShell title="Set up PagerDuty ↔ ServiceNow" hideBack nextLabel="Get started">
      <Stack maw={640}>
        <Text>
          This wizard stands up the PagerDuty ServiceNow integration end to end against a sandbox instance: it
          installs the PagerDuty app, configures ServiceNow for it, validates both systems, matches existing users by
          email, provisions the ServiceNow integration user PagerDuty authenticates as, and offers to link existing
          PagerDuty users, services and escalation policies into ServiceNow.
        </Text>
        <Text size="sm" fw={600}>
          What you need
        </Text>
        <List spacing="xs" size="sm">
          <List.Item>
            A ServiceNow <code>admin</code> account with these two roles added, so it can use the REST and Table APIs
            with Basic auth: <code>snc_basic_auth_api_access</code> and <code>snc_platform_rest_api_access</code>
          </List.Item>
          <List.Item>The PagerDuty app's update set XML export (skip it if the app is already installed)</List.Item>
          <List.Item>
            Already installed and configured? Each step checks what's there and offers to keep it as is, fix it, or
            reconfigure it
          </List.Item>
          <List.Item>A PagerDuty REST API token</List.Item>
        </List>
        <Text size="sm" fw={600}>
          What it does
        </Text>
        <List spacing="xs" size="sm">
          <List.Item>Connect &amp; validate ServiceNow and check table access for the app (Application Access settings)</List.Item>
          <List.Item>Install the PagerDuty app from the update set XML</List.Item>
          <List.Item>Connect &amp; validate PagerDuty (users from both systems are pulled and matched by email in the background)</List.Item>
          <List.Item>Start a ServiceNow update set and apply the base integration settings</List.Item>
          <List.Item>Add the PagerDuty fields to views and map PagerDuty priorities to Impact/Urgency</List.Item>
          <List.Item>Create the ServiceNow integration user (linked to the same PagerDuty user as the app's default user), then link users, services (to CIs) and escalation policies (to assignment groups)</List.Item>
        </List>
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} title="This makes real changes">
          Starting at "Table Access", steps write to your ServiceNow instance and/or PagerDuty account.
          Point this at a sandbox, not production. Credentials you enter stay in this browser tab only — they're
          relayed straight to ServiceNow/PagerDuty by the local backend and never written to disk.
        </Alert>
      </Stack>
    </StepShell>
  );
}
