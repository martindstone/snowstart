import { useState } from "react";
import { Alert, Badge, Button, Container, Group, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import { SNApiError, checkPdAppInstalled, testCredentials } from "../api/servicenow";
import { PDApiError, testApiToken } from "../api/pagerduty";
import { useAppStore } from "../store/appStore";

/**
 * The gate in front of the whole app: every screen needs both ServiceNow and PagerDuty, so nothing else is shown until
 * both are validated. Credentials live in this tab's memory only.
 */
export default function ConnectScreen() {
  const snAdminUser = useAppStore((s) => s.snAdminUser);
  const pdConnection = useAppStore((s) => s.pdConnection);

  return (
    <Container size={520} py="xl">
      <Stack gap="lg">
        <div>
          <Title order={2}>SnowStart</Title>
          <Text c="dimmed" size="sm" mt={4}>
            Set up and manage the PagerDuty ↔ ServiceNow integration. Connect to both systems to begin. Credentials stay in
            this browser tab: they're relayed straight to ServiceNow and PagerDuty by the local server and never written to
            disk. Use a sandbox instance.
          </Text>
        </div>
        <ServiceNowCard done={!!snAdminUser} />
        <PagerDutyCard done={!!pdConnection} />
        {snAdminUser && pdConnection && <Text c="dimmed">Connected. Checking this instance…</Text>}
      </Stack>
    </Container>
  );
}

function ServiceNowCard({ done }: { done: boolean }) {
  const setSnConnection = useAppStore((s) => s.setSnConnection);
  const clear = useAppStore((s) => s.clearSnConnection);
  const snAdminUser = useAppStore((s) => s.snAdminUser);
  const snCreds = useAppStore((s) => s.snCreds);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    initialValues: { instanceUrl: "", username: "admin", password: "" },
    validate: {
      instanceUrl: (v) =>
        /^https:\/\/[^\s/]+\/?$/i.test(v.trim()) ? null : "Must be an https URL, e.g. https://yourinstance.service-now.com",
      username: (v) => (v ? null : "Required"),
      password: (v) => (v ? null : "Required"),
    },
  });

  const connect = async () => {
    if (form.validate().hasErrors) return;
    setValidating(true);
    setError(null);
    const creds = {
      instanceUrl: form.values.instanceUrl.trim().replace(/\/$/, ""),
      username: form.values.username.trim(),
      password: form.values.password,
    };
    try {
      const user = await testCredentials(creds);
      const scope = await checkPdAppInstalled(creds);
      setSnConnection(creds, user, scope);
      form.setFieldValue("password", "");
    } catch (e) {
      setError(e instanceof SNApiError ? e.message : e instanceof Error ? e.message : "Could not connect");
    } finally {
      setValidating(false);
    }
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="sm">
        <Title order={4}>ServiceNow</Title>
        {done && (
          <Badge color="green" leftSection={<IconCheck size={12} />}>
            Connected
          </Badge>
        )}
      </Group>
      {done ? (
        <Group justify="space-between">
          <Text size="sm">
            {snAdminUser?.user_name} on {snCreds?.instanceUrl.replace(/^https:\/\//, "")}
          </Text>
          <Button variant="subtle" size="xs" onClick={clear}>
            Change
          </Button>
        </Group>
      ) : (
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            Your sandbox instance and an <code>admin</code> account that also has the roles <code>snc_basic_auth_api_access</code>{" "}
            and <code>snc_platform_rest_api_access</code>, so it can use the REST and Table APIs with Basic auth.
          </Text>
          <TextInput label="Instance URL" placeholder="https://dev12345.service-now.com" {...form.getInputProps("instanceUrl")} />
          <TextInput label="Admin username" {...form.getInputProps("username")} />
          <PasswordInput label="Admin password" {...form.getInputProps("password")} />
          <Group>
            <Button onClick={connect} loading={validating}>
              Connect
            </Button>
          </Group>
          {error && (
            <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Connection failed">
              {error}
            </Alert>
          )}
        </Stack>
      )}
    </Paper>
  );
}

function PagerDutyCard({ done }: { done: boolean }) {
  const setPdConnection = useAppStore((s) => s.setPdConnection);
  const clear = useAppStore((s) => s.clearPdConnection);
  const pdConnection = useAppStore((s) => s.pdConnection);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    initialValues: { apiToken: "" },
    validate: { apiToken: (v) => (v ? null : "Required") },
  });

  const connect = async () => {
    if (form.validate().hasErrors) return;
    setValidating(true);
    setError(null);
    const creds = { apiToken: form.values.apiToken.trim() };
    try {
      setPdConnection(creds, await testApiToken(creds));
      form.setFieldValue("apiToken", "");
    } catch (e) {
      setError(e instanceof PDApiError ? e.message : e instanceof Error ? e.message : "Could not connect");
    } finally {
      setValidating(false);
    }
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="sm">
        <Title order={4}>PagerDuty</Title>
        {done && (
          <Badge color="green" leftSection={<IconCheck size={12} />}>
            Connected
          </Badge>
        )}
      </Group>
      {done ? (
        <Group justify="space-between">
          <Text size="sm">
            {pdConnection?.tokenType === "user"
              ? `${pdConnection.user?.name} (${pdConnection.user?.email})`
              : "Account-level API token"}
          </Text>
          <Button variant="subtle" size="xs" onClick={clear}>
            Change
          </Button>
        </Group>
      ) : (
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            A REST API v2 token (Integrations → API Access Keys). Both user-level and account-level tokens work.
          </Text>
          <PasswordInput label="API token" {...form.getInputProps("apiToken")} />
          <Group>
            <Button onClick={connect} loading={validating}>
              Connect
            </Button>
          </Group>
          {error && (
            <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Connection failed">
              {error}
            </Alert>
          )}
        </Stack>
      )}
    </Paper>
  );
}
