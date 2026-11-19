import { useEffect, useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, List, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import Section from "../components/Section";
import { applyViewPlan, checkViewStatus, COMMON_CI_CLASSES, VIEW_PLAN, type LayoutResult, type ViewStatus } from "../api/views";
import { SNApiError } from "../api/servicenow";
import { currentSnCreds, useAppStore } from "../store/appStore";

function EntryBadge({ entry }: { entry: ViewStatus | undefined }) {
  if (!entry) return null;
  if (entry.fields.length === 0) return <Badge color="gray" variant="light">not in this app version</Badge>;
  const complete = entry.missing.every((m) => m.fields.length === 0);
  return complete ? (
    <Badge color="green" variant="light" leftSection={<IconCheck size={10} />}>
      complete
    </Badge>
  ) : (
    <Badge color="gray" variant="light">
      not added yet
    </Badge>
  );
}

export default function ViewsSection() {
  const logChange = useAppStore((s) => s.logChange);
  const refreshConfigStatus = useAppStore((s) => s.refreshConfigStatus);
  const [status, setStatus] = useState<ViewStatus[] | null>(null);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(Object.fromEntries(VIEW_PLAN.map((e) => [e.key, true])));
  const [ciClasses, setCiClasses] = useState<string[]>(["cmdb_ci", "cmdb_ci_appl"]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recheck = async (classes?: string[]) => {
    try {
      setStatus(await checkViewStatus(currentSnCreds(), classes ? { cis: classes } : {}));
    } catch {
      setStatus(null); // the status is a convenience; applying still works without it
    }
  };
  useEffect(() => {
    void recheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    setLines([]);
    try {
      const creds = currentSnCreds();
      const out: string[] = [];
      for (const entry of VIEW_PLAN.filter((e) => enabled[e.key])) {
        const { fields, results } = await applyViewPlan(creds, entry, entry.key === "cis" ? ciClasses : undefined);
        if (fields.length === 0) {
          out.push(`${entry.label}: the app defines none of the expected fields, so it was skipped`);
          continue;
        }
        results.forEach((r: LayoutResult) => {
          const where = `${r.table} ${r.layout}`;
          // Only problems are listed here; what was added is in the Changes drawer.
          if (r.note) out.push(`${where}: ${r.note}`);
          else if (r.added.length) {
            logChange({
              system: "servicenow",
              table: r.layout === "list" ? "sys_ui_list_element" : "sys_ui_element",
              recordId: r.table,
              description: `Added ${r.added.join(", ")} to the ${r.table} ${r.layout} (Default view)`,
            });
          }
        });
      }
      setLines(out);
      setDone(true);
      await recheck(ciClasses);
      void refreshConfigStatus();
    } catch (e) {
      setError(e instanceof SNApiError ? e.message : e instanceof Error ? e.message : "Couldn't update the views");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Section
      title="Add PagerDuty fields to views"
      description="Puts the PagerDuty fields on the Default view list columns and forms so they're visible (step 1.3 of PagerDuty's guide). Fields already on a layout are left alone."
    >
      <Stack maw={560}>
        {VIEW_PLAN.map((entry) => (
          <Checkbox
            key={entry.key}
            label={
              <Group gap="xs">
                {entry.label}
                <EntryBadge entry={status?.find((x) => x.key === entry.key)} />
              </Group>
            }
            description={entry.fields.map((f) => f.replace("x_pd_integration_", "")).join(", ")}
            checked={enabled[entry.key]}
            onChange={(e) => setEnabled((s) => ({ ...s, [entry.key]: e.currentTarget.checked }))}
            disabled={running}
          />
        ))}
        {enabled.cis && (
          <Checkbox.Group label="CI classes whose form gets the fields" value={ciClasses} onChange={setCiClasses}>
            <Group mt="xs" gap="md">
              {COMMON_CI_CLASSES.map((c) => (
                <Checkbox key={c} value={c} label={c} size="xs" disabled={running} />
              ))}
            </Group>
          </Checkbox.Group>
        )}
        <Group>
          <Button onClick={run} loading={running}>
            {done ? "Run again" : "Add to views"}
          </Button>
          {done && (
            <Text c="green" size="sm">
              <IconCheck size={14} style={{ verticalAlign: "middle" }} /> Done
            </Text>
          )}
        </Group>
        {lines.length > 0 && (
          <List size="sm" spacing={2}>
            {lines.map((l) => (
              <List.Item key={l}>{l}</List.Item>
            ))}
          </List>
        )}
        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Failed">
            {error}
          </Alert>
        )}
      </Stack>
    </Section>
  );
}
