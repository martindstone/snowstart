import { useState } from "react";
import { Alert, Badge, Button, Group, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import StepShell from "../components/StepShell";
import { SNApiError, checkPdAppInstalled, testCredentials } from "../api/servicenow";
import { PD_APP_SCOPE } from "../config/schema";
import { useWizardStore } from "../store/wizardStore";

export default function Step1ConnectServiceNow() {
  const setSnConnection = useWizardStore((s) => s.setSnConnection);
  const snAdminUser = useWizardStore((s) => s.snAdminUser);
  const snScope = useWizardStore((s) => s.snScope);
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

  const connected = !!snAdminUser;

  const handleValidate = async () => {
    const result = form.validate();
    if (result.hasErrors) return;
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
    } catch (e) {
      setError(e instanceof SNApiError ? e.message : e instanceof Error ? e.message : "Could not connect");
    } finally {
      setValidating(false);
    }
  };

  return (
    <StepShell
      title="Connect to ServiceNow"
      description="Your sandbox instance URL and an admin account. Nothing is stored outside this browser tab."
      nextDisabled={!connected}
    >
      <Stack maw={480}>
        <TextInput label="Instance URL" placeholder="https://dev12345.service-now.com" {...form.getInputProps("instanceUrl")} />
        <TextInput label="Admin username" {...form.getInputProps("username")} />
        <PasswordInput label="Admin password" {...form.getInputProps("password")} />
        <Group>
          <Button variant="light" onClick={handleValidate} loading={validating}>
            Validate
          </Button>
          {connected && (
            <Badge color="green" leftSection={<IconCheck size={14} />}>
              Connected as {snAdminUser?.user_name}
            </Badge>
          )}
        </Group>

        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Connection failed">
            {error}
          </Alert>
        )}
        {connected && snScope && (
          <Text size="sm" c="dimmed">
            Found {snScope.name} v{snScope.version} (scope <code>{snScope.scope}</code>)
          </Text>
        )}
        {connected && snScope && snScope.scope !== PD_APP_SCOPE && (
          <Alert color="yellow" icon={<IconAlertTriangle size={16} />} title="Non-standard app scope">
            The PagerDuty app is installed under scope <code>{snScope.scope}</code>, not <code>{PD_APP_SCOPE}</code>.
            This wizard writes <code>{PD_APP_SCOPE}.*</code> properties and <code>{PD_APP_SCOPE}_*</code> fields —
            if those don't exist on this build, later steps will fail.
          </Alert>
        )}
        {connected && !snScope && (
          <Alert color="blue" title="PagerDuty app not installed yet">
            Credentials work. The next step installs the PagerDuty app from an update set XML you provide.
          </Alert>
        )}
      </Stack>
    </StepShell>
  );
}
