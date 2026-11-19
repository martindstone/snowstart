import { useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Stack, Table, Text } from "@mantine/core";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import StepShell from "../components/StepShell";
import { ACCESS_FLAG_LABELS, applyTableAccess, getTableAccess, type TableAccessState } from "../api/prepare";
import { SNApiError } from "../api/servicenow";
import { flushServiceNowCache } from "../api/cacheFlush";
import { currentAdminId, currentSnCreds, snRecordLink, useWizardStore } from "../store/wizardStore";

export default function StepTableAccess() {
  const logChange = useWizardStore((s) => s.logChange);
  const [states, setStates] = useState<TableAccessState[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setStates(await getTableAccess(currentSnCreds()));
    } catch (e) {
      setError(e instanceof SNApiError ? e.message : e instanceof Error ? e.message : "Couldn't read table access");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Reads once on arrival; the Fix button re-reads after writing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fixable = (states ?? []).filter((s) => s.sysId && s.missing.length > 0);
  const allGood = states !== null && states.every((s) => s.missing.length === 0);

  const handleFix = async () => {
    setFixing(true);
    setError(null);
    try {
      const creds = currentSnCreds();
      for (const state of fixable) {
        await applyTableAccess(creds, state);
        logChange({
          system: "servicenow",
          table: "sys_db_object",
          recordId: state.sysId,
          description: `Allowed ${state.missing.map((f) => `"${ACCESS_FLAG_LABELS[f]}"`).join(", ")} on table ${state.table} so the PagerDuty app can use it`,
          link: snRecordLink(creds.instanceUrl, "sys_db_object", state.sysId),
        });
      }
      if (fixable.length > 0) {
        // ServiceNow's permission cache can keep refusing the app after these flags change (PagerDuty's
        // troubleshooting guide prescribes gs.invalidateCache()), so clear it right away.
        setFlushing(true);
        await flushServiceNowCache(creds, currentAdminId());
        logChange({
          system: "servicenow",
          table: "sysauto_script",
          recordId: "gs.invalidateCache",
          description: "Cleared ServiceNow's cache (gs.invalidateCache) so the new Application Access settings take effect",
        });
      }
      await load();
    } catch (e) {
      setError(e instanceof SNApiError ? e.message : e instanceof Error ? e.message : "Couldn't update table access");
    } finally {
      setFixing(false);
      setFlushing(false);
    }
  };

  return (
    <StepShell
      title="Table access for the PagerDuty app"
      description="The app runs in its own scope but reads and writes these global tables, so their Application Access settings have to allow it (step 1.1 of PagerDuty's guide)."
    >
      <Stack maw={640}>
        {loading && !states && <Text c="dimmed">Reading current settings…</Text>}

        {states && (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Table</Table.Th>
                <Table.Th>Needs</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {states.map((s) => (
                <Table.Tr key={s.table}>
                  <Table.Td>
                    <code>{s.table}</code>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{s.required.map((f) => ACCESS_FLAG_LABELS[f]).join(", ")}</Text>
                  </Table.Td>
                  <Table.Td>
                    {s.missing.length === 0 ? (
                      <Badge color="green" leftSection={<IconCheck size={12} />}>
                        OK
                      </Badge>
                    ) : (
                      <Badge color="orange">missing: {s.missing.map((f) => ACCESS_FLAG_LABELS[f]).join(", ")}</Badge>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}

        {flushing && (
          <Text size="sm" c="dimmed">
            Clearing ServiceNow's cache so the new settings take effect (takes about 20 seconds)…
          </Text>
        )}
        <Group>
          <Button onClick={handleFix} loading={fixing} disabled={fixable.length === 0}>
            {fixable.length > 0 ? `Fix ${fixable.length} table${fixable.length === 1 ? "" : "s"}` : "Nothing to fix"}
          </Button>
          {allGood && <Text size="sm" c="green">All set.</Text>}
        </Group>

        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Failed">
            {error}
          </Alert>
        )}
      </Stack>
    </StepShell>
  );
}
