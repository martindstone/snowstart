import { useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Select, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import StepShell from "../components/StepShell";
import { createRecord, getTablePage, setCurrentUpdateSet, SNApiError } from "../api/servicenow";
import { SN_TABLES } from "../config/schema";
import { currentSnCreds, useWizardStore, snRecordLink } from "../store/wizardStore";
import type { SNUpdateSet } from "../types/servicenow";

function defaultName() {
  const today = new Date().toISOString().slice(0, 10);
  return `PagerDuty Integration Setup — ${today}`;
}

export default function Step4UpdateSet() {
  const updateSet = useWizardStore((s) => s.updateSet);
  const setUpdateSet = useWizardStore((s) => s.setUpdateSet);
  const logChange = useWizardStore((s) => s.logChange);
  const snAdminUser = useWizardStore((s) => s.snAdminUser);
  const snCreds = useWizardStore((s) => s.snCreds);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inProgress, setInProgress] = useState<SNUpdateSet[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);

  // Update sets already in progress can be reused rather than starting another.
  useEffect(() => {
    if (!snCreds) return;
    getTablePage<SNUpdateSet>(snCreds, SN_TABLES.sysUpdateSet, {
      sysparm_query: "state=in progress^ORDERBYDESCsys_created_on",
      sysparm_fields: "sys_id,name,description,state",
      sysparm_limit: 25,
    })
      .then(setInProgress)
      .catch(() => undefined); // optional convenience; creating a new one still works
  }, [snCreds]);

  const handleUseExisting = async () => {
    const chosen = inProgress.find((u) => u.sys_id === pickedId);
    if (!chosen || !snAdminUser) return;
    setCreating(true);
    setError(null);
    try {
      const creds = currentSnCreds();
      await setCurrentUpdateSet(creds, snAdminUser.sys_id, chosen.sys_id);
      setUpdateSet(chosen);
      logChange({
        system: "servicenow",
        table: SN_TABLES.sysUpdateSet,
        recordId: chosen.sys_id,
        description: `Made existing update set "${chosen.name}" the current one for ${snAdminUser.user_name}`,
        link: snRecordLink(creds.instanceUrl, "sys_update_set", chosen.sys_id),
      });
    } catch (e) {
      setError(e instanceof SNApiError ? e.message : e instanceof Error ? e.message : "Failed to switch update set");
    } finally {
      setCreating(false);
    }
  };

  const form = useForm({
    initialValues: { name: defaultName(), description: "Created by SnowStart." },
    validate: { name: (v) => (v ? null : "Required") },
  });

  const handleCreate = async () => {
    const result = form.validate();
    if (result.hasErrors || !snAdminUser) return;
    setCreating(true);
    setError(null);
    try {
      const creds = currentSnCreds();
      const record = await createRecord<SNUpdateSet>(creds, SN_TABLES.sysUpdateSet, {
        name: form.values.name,
        description: form.values.description,
      });
      await setCurrentUpdateSet(creds, snAdminUser.sys_id, record.sys_id);
      setUpdateSet(record);
      logChange({
        system: "servicenow",
        table: SN_TABLES.sysUpdateSet,
        recordId: record.sys_id,
        description: `Created update set "${record.name}" and set it as current for ${snAdminUser.user_name}`,
        link: snRecordLink(creds.instanceUrl, "sys_update_set", record.sys_id),
      });
    } catch (e) {
      setError(e instanceof SNApiError ? e.message : e instanceof Error ? e.message : "Failed to create update set");
    } finally {
      setCreating(false);
    }
  };

  return (
    <StepShell
      title="Start an update set"
      description="Every configuration change from here on is tracked in this update set so it can be reviewed and moved between instances."
      nextDisabled={!updateSet && !skipped}
    >
      <Stack maw={480}>
        {!updateSet && inProgress.length > 0 && (
          <Group align="end">
            <Select
              style={{ flex: 1 }}
              label="Use an update set that's already in progress"
              placeholder="Select one, or create a new one below"
              searchable
              clearable
              data={inProgress.map((u) => ({ value: u.sys_id, label: u.name }))}
              value={pickedId}
              onChange={setPickedId}
              disabled={skipped}
            />
            <Button variant="light" onClick={handleUseExisting} loading={creating} disabled={!pickedId || skipped}>
              Use it
            </Button>
          </Group>
        )}
        <TextInput label="Name" disabled={!!updateSet} {...form.getInputProps("name")} />
        <Textarea
          label="Description"
          disabled={!!updateSet}
          autosize
          minRows={2}
          {...form.getInputProps("description")}
        />
        <Group>
          <Button onClick={handleCreate} loading={creating} disabled={!!updateSet || skipped} variant="light">
            Create update set
          </Button>
          {!updateSet && (
            <Button variant="default" onClick={() => setSkipped((v) => !v)}>
              {skipped ? "Undo skip" : "Skip — don't track changes in an update set"}
            </Button>
          )}
          {skipped && !updateSet && <Badge color="gray">Skipped</Badge>}
          {updateSet && (
            <Badge color="green" leftSection={<IconCheck size={14} />}>
              Active: {updateSet.name}
            </Badge>
          )}
        </Group>
        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Failed">
            {error}
          </Alert>
        )}
        {updateSet && snCreds && (
          <Text size="sm" c="dimmed">
            <a
              href={snRecordLink(snCreds.instanceUrl, "sys_update_set", updateSet.sys_id)}
              target="_blank"
              rel="noreferrer"
            >
              Open in ServiceNow
            </a>
          </Text>
        )}
      </Stack>
    </StepShell>
  );
}
