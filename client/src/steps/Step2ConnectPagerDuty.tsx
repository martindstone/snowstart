import { useState } from "react";
import { Alert, Badge, Button, Group, PasswordInput, Stack, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import StepShell from "../components/StepShell";
import { PDApiError, testApiToken } from "../api/pagerduty";
import { useWizardStore } from "../store/wizardStore";

export default function Step2ConnectPagerDuty() {
  const setPdConnection = useWizardStore((s) => s.setPdConnection);
  const pdConnection = useWizardStore((s) => s.pdConnection);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    initialValues: { apiToken: "" },
    validate: { apiToken: (v) => (v ? null : "Required") },
  });

  const connected = !!pdConnection;

  const handleValidate = async () => {
    const result = form.validate();
    if (result.hasErrors) return;
    setValidating(true);
    setError(null);
    const creds = { apiToken: form.values.apiToken.trim() };
    try {
      const connection = await testApiToken(creds);
      setPdConnection(creds, connection);
    } catch (e) {
      setError(e instanceof PDApiError ? e.message : e instanceof Error ? e.message : "Could not connect");
    } finally {
      setValidating(false);
    }
  };

  return (
    <StepShell
      title="Connect to PagerDuty"
      description="A REST API v2 token (Integrations > API Access Keys). Both user-level and account-level tokens work."
      nextDisabled={!connected}
    >
      <Stack maw={480}>
        <PasswordInput label="API token" {...form.getInputProps("apiToken")} />
        <Group>
          <Button variant="light" onClick={handleValidate} loading={validating}>
            Validate
          </Button>
          {connected && pdConnection.tokenType === "user" && (
            <Badge color="green" leftSection={<IconCheck size={14} />}>
              Connected as {pdConnection.user?.name}
            </Badge>
          )}
          {connected && pdConnection.tokenType === "account" && (
            <Badge color="green" leftSection={<IconCheck size={14} />}>
              Connected (account-level token)
            </Badge>
          )}
        </Group>
        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Connection failed">
            {error}
          </Alert>
        )}
        {connected && pdConnection.user && (
          <Text size="sm" c="dimmed">
            {pdConnection.user.email}
          </Text>
        )}
      </Stack>
    </StepShell>
  );
}
