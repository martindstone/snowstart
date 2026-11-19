import { useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Stack, Table, Text } from "@mantine/core";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import StepShell from "../components/StepShell";
import { applyPriority, isUpToDate, planPriorities, type PriorityPlanRow } from "../api/priorities";
import { SNApiError } from "../api/servicenow";
import { PDApiError } from "../api/pagerduty";
import { currentPdCreds, currentSnCreds, snRecordLink, useWizardStore } from "../store/wizardStore";

export default function StepPriorities() {
  const logChange = useWizardStore((s) => s.logChange);
  const [rows, setRows] = useState<PriorityPlanRow[] | null>(null);
  const [pdCount, setPdCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const plan = await planPriorities(currentSnCreds(), currentPdCreds());
      setRows(plan.rows);
      setPdCount(plan.pdCount);
    } catch (e) {
      setError(
        e instanceof SNApiError || e instanceof PDApiError ? e.message : e instanceof Error ? e.message : "Couldn't plan priorities",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = (rows ?? []).filter((r) => !isUpToDate(r));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const creds = currentSnCreds();
      for (const row of pending) {
        const { sysId, created } = await applyPriority(creds, row);
        logChange({
          system: "servicenow",
          table: "x_pd_integration_pagerduty_priority",
          recordId: sysId,
          description: `${created ? "Created" : "Updated"} priority mapping ${row.pdPriorityName} → impact ${row.impact}, urgency ${row.urgency} (ServiceNow priority ${row.snPriority})`,
          link: snRecordLink(creds.instanceUrl, "x_pd_integration_pagerduty_priority", sysId),
        });
      }
      await load();
    } catch (e) {
      setError(e instanceof SNApiError ? e.message : e instanceof Error ? e.message : "Couldn't save the mappings");
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  return (
    <StepShell
      title="Priority mapping"
      description="Maps each PagerDuty priority to a ServiceNow Impact and Urgency. ServiceNow's own priority lookup rules turn that pair into the incident priority, so the mapping is chosen from this instance's actual lookup table."
    >
      <Stack maw={640}>
        {loading && !rows && <Text c="dimmed">Reading priorities…</Text>}

        {rows && pdCount === 0 && (
          <Alert color="blue" title="No priorities in this PagerDuty account">
            Priorities are an optional PagerDuty feature. Nothing to map — continue.
          </Alert>
        )}

        {rows && rows.length > 0 && (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>PagerDuty priority</Table.Th>
                <Table.Th>Impact</Table.Th>
                <Table.Th>Urgency</Table.Th>
                <Table.Th>ServiceNow priority</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.pdPriorityId}>
                  <Table.Td>{r.pdPriorityName}</Table.Td>
                  <Table.Td>{r.impact}</Table.Td>
                  <Table.Td>{r.urgency}</Table.Td>
                  <Table.Td>{r.snPriority}</Table.Td>
                  <Table.Td>
                    {isUpToDate(r) ? (
                      <Badge color="green" leftSection={<IconCheck size={12} />}>
                        saved
                      </Badge>
                    ) : r.existingId ? (
                      <Badge color="orange">will update</Badge>
                    ) : (
                      <Badge color="blue">will create</Badge>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}

        <Group>
          <Button onClick={save} loading={saving} disabled={pending.length === 0}>
            {pending.length > 0 ? `Save ${pending.length} mapping${pending.length === 1 ? "" : "s"}` : "Nothing to save"}
          </Button>
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
