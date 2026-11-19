import { useState } from "react";
import { Alert, Button, Checkbox, Group, List, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import StepShell from "../components/StepShell";
import { applyViewPlan, COMMON_CI_CLASSES, VIEW_PLAN, type LayoutResult } from "../api/views";
import { SNApiError } from "../api/servicenow";
import { currentSnCreds, useWizardStore } from "../store/wizardStore";

export default function StepViews() {
  const logChange = useWizardStore((s) => s.logChange);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(Object.fromEntries(VIEW_PLAN.map((e) => [e.key, true])));
  const [ciClasses, setCiClasses] = useState<string[]>(["cmdb_ci", "cmdb_ci_appl"]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

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
          out.push(`${entry.label}: the app defines none of the expected fields — skipped`);
          continue;
        }
        results.forEach((r: LayoutResult) => {
          const where = `${r.table} ${r.layout}`;
          if (r.note) out.push(`${where}: ${r.note}`);
          else if (r.added.length) {
            out.push(`${where}: added ${r.added.join(", ")}`);
            logChange({
              system: "servicenow",
              table: r.layout === "list" ? "sys_ui_list_element" : "sys_ui_element",
              recordId: r.table,
              description: `Added ${r.added.join(", ")} to the ${r.table} ${r.layout} (Default view)`,
            });
          } else out.push(`${where}: already complete`);
        });
      }
      setLines(out);
      setDone(true);
    } catch (e) {
      setError(e instanceof SNApiError ? e.message : e instanceof Error ? e.message : "Couldn't update the views");
    } finally {
      setRunning(false);
    }
  };

  return (
    <StepShell
      title="Add PagerDuty fields to views"
      description="Puts the PagerDuty fields on the Default view list columns and forms so they're visible (step 1.3 of PagerDuty's guide). Fields already on a layout are left alone."
    >
      <Stack maw={560}>
        {VIEW_PLAN.map((entry) => (
          <Checkbox
            key={entry.key}
            label={entry.label}
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
    </StepShell>
  );
}
