import { useEffect, useState } from "react";
import { Alert, Anchor, Button, Divider, Group, Select, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconAlertTriangle } from "@tabler/icons-react";
import { createRecord, getTablePage, setCurrentUpdateSet, SNApiError } from "../api/servicenow";
import { SN_TABLES } from "../config/schema";
import { currentSnCreds, snRecordLink, useAppStore } from "../store/appStore";
import type { SNUpdateSet } from "../types/servicenow";

function defaultName() {
  const today = new Date().toISOString().slice(0, 10);
  return `PagerDuty Integration Setup — ${today}`;
}

/**
 * Chooses the update set that captures the configuration changes made from here on: reuse one that's in progress,
 * start a new one, or work without one. It applies to every section of the app, so it lives behind a header control.
 */
export default function UpdateSetPanel({ onDone }: { onDone?: () => void }) {
  const updateSet = useAppStore((s) => s.updateSet);
  const updateSetSkipped = useAppStore((s) => s.updateSetSkipped);
  const setUpdateSet = useAppStore((s) => s.setUpdateSet);
  const setUpdateSetSkipped = useAppStore((s) => s.setUpdateSetSkipped);
  const logChange = useAppStore((s) => s.logChange);
  const snAdminUser = useAppStore((s) => s.snAdminUser);
  const snCreds = useAppStore((s) => s.snCreds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inProgress, setInProgress] = useState<SNUpdateSet[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);

  const form = useForm({
    initialValues: { name: defaultName(), description: "Created by SnowStart." },
    validate: { name: (v) => (v ? null : "Required") },
  });

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

  const activate = async (record: SNUpdateSet, description: string) => {
    if (!snAdminUser) return;
    const creds = currentSnCreds();
    await setCurrentUpdateSet(creds, snAdminUser.sys_id, record.sys_id);
    setUpdateSet(record);
    logChange({
      system: "servicenow",
      table: SN_TABLES.sysUpdateSet,
      recordId: record.sys_id,
      description,
      link: snRecordLink(creds.instanceUrl, "sys_update_set", record.sys_id),
    });
    onDone?.();
  };

  const run = async (work: () => Promise<void>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof SNApiError ? e.message : e instanceof Error ? e.message : failure);
    } finally {
      setBusy(false);
    }
  };

  const useExisting = () => {
    const chosen = inProgress.find((u) => u.sys_id === pickedId);
    if (!chosen) return;
    void run(() => activate(chosen, `Made existing update set "${chosen.name}" the current one for ${snAdminUser?.user_name}`), "Failed to switch update set");
  };

  const create = () => {
    if (form.validate().hasErrors) return;
    void run(async () => {
      const record = await createRecord<SNUpdateSet>(currentSnCreds(), SN_TABLES.sysUpdateSet, {
        name: form.values.name,
        description: form.values.description,
      });
      await activate(record, `Created update set "${record.name}" and set it as current for ${snAdminUser?.user_name}`);
    }, "Failed to create update set");
  };

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Configuration changes made from here on are captured in the current update set, so they can be reviewed and moved to
        another instance.
      </Text>

      {updateSet && snCreds && (
        <Text size="sm">
          Current:{" "}
          <Anchor href={snRecordLink(snCreds.instanceUrl, "sys_update_set", updateSet.sys_id)} target="_blank">
            {updateSet.name}
          </Anchor>
        </Text>
      )}
      {!updateSet && updateSetSkipped && <Text size="sm">Working without an update set: changes aren't tracked.</Text>}

      {inProgress.length > 0 && (
        <Group align="end">
          <Select
            style={{ flex: 1 }}
            label="Use an update set that's already in progress"
            placeholder="Select one"
            searchable
            clearable
            data={inProgress.map((u) => ({ value: u.sys_id, label: u.name }))}
            value={pickedId}
            onChange={setPickedId}
          />
          <Button variant="light" onClick={useExisting} loading={busy} disabled={!pickedId}>
            Use it
          </Button>
        </Group>
      )}

      {inProgress.length > 0 && <Divider label="or start a new one" labelPosition="left" />}
      <TextInput label="Name" {...form.getInputProps("name")} />
      <Textarea label="Description" autosize minRows={2} {...form.getInputProps("description")} />
      <Group>
        <Button onClick={create} loading={busy} variant="light">
          Create update set
        </Button>
        {!updateSet && (
          <Button
            variant="default"
            onClick={() => {
              setUpdateSetSkipped(true);
              onDone?.();
            }}
          >
            Work without an update set
          </Button>
        )}
      </Group>

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Failed">
          {error}
        </Alert>
      )}
    </Stack>
  );
}
