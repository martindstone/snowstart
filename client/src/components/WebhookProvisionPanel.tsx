import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Group, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import { findCisNeedingWebhook, provisionCiWebhooks, type CiNeedingWebhook } from "../api/webhookProvisioning";
import { currentSnCreds, snRecordLink, useAppStore } from "../store/appStore";

/**
 * Above the CI link table: provisions PagerDuty webhooks for linked CIs using the app's own "Provision Webhook into
 * PagerDuty" code. It runs by itself when a batch of links has been applied, and the button covers CIs that were already
 * linked (or a retry after a failure). Optional in the end: the app would otherwise create each webhook when the CI's
 * first incident arrives.
 */
interface Props {
  /** Changes as links are applied. */
  appliedCount: number;
  /** True while a batch of links is being applied. */
  applying: boolean;
}

export default function WebhookProvisionPanel({ appliedCount, applying }: Props) {
  const snAdminUser = useAppStore((s) => s.snAdminUser);
  const logChange = useAppStore((s) => s.logChange);
  const [pending, setPending] = useState<CiNeedingWebhook[] | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<{ name: string; error: string }[]>([]);
  const [doneCount, setDoneCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const list = await findCisNeedingWebhook(currentSnCreds());
      setCheckError(null);
      setPending(list);
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : "Couldn't check for CIs without webhooks");
    }
  }, []);

  const provision = useCallback(
    async (list: CiNeedingWebhook[]) => {
      if (list.length === 0 || !snAdminUser) return;
      setRunning(true);
      setError(null);
      setFailures([]);
      try {
        const creds = currentSnCreds();
        const outcomes = await provisionCiWebhooks(creds, snAdminUser.sys_id, list);
        const byId = new Map(list.map((c) => [c.sysId, c]));
        const bad: { name: string; error: string }[] = [];
        let ok = 0;
        for (const o of outcomes) {
          const ci = byId.get(o.ci);
          if (!ci) continue;
          if (o.error || !o.webhookId) {
            bad.push({ name: ci.name, error: o.error ?? "No webhook id returned" });
            continue;
          }
          ok++;
          logChange({
            system: "pagerduty",
            table: "webhook_subscription",
            recordId: o.webhookId,
            description: `${o.action === "created" ? "Created" : "Re-linked existing"} PagerDuty webhook ${o.webhookId} for CI "${ci.name}" using the app's Provision Webhook code`,
            link: snRecordLink(creds.instanceUrl, "cmdb_ci", ci.sysId),
          });
        }
        const reported = new Set(outcomes.map((o) => o.ci));
        list
          .filter((c) => !reported.has(c.sysId))
          .forEach((c) => bad.push({ name: c.name, error: "No result was reported for this CI" }));
        setDoneCount((n) => n + ok);
        setFailures(bad);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to provision webhooks");
      } finally {
        setRunning(false);
      }
    },
    [snAdminUser, logChange, refresh],
  );

  // Check on mount, and again once a batch of links has finished applying (not mid-batch, which would race).
  useEffect(() => {
    if (applying) return;
    let cancelled = false;
    findCisNeedingWebhook(currentSnCreds())
      .then((list) => {
        if (cancelled) return;
        setCheckError(null);
        setPending(list);
      })
      .catch((e) => {
        if (!cancelled) setCheckError(e instanceof Error ? e.message : "Couldn't check for CIs without webhooks");
      });
    return () => {
      cancelled = true;
    };
  }, [applying, appliedCount]);

  // When a batch of links finishes, provision the webhooks for the CIs it left without one.
  const handled = useRef(0);
  useEffect(() => {
    if (applying || appliedCount <= handled.current) return;
    handled.current = appliedCount;
    findCisNeedingWebhook(currentSnCreds())
      .then((list) => {
        setPending(list);
        return provision(list);
      })
      .catch((e) => setCheckError(e instanceof Error ? e.message : "Couldn't check for CIs without webhooks"));
  }, [applying, appliedCount, provision]);

  if (checkError) {
    return (
      <Alert color="orange" icon={<IconAlertTriangle size={16} />} title="Couldn't check CI webhooks">
        {checkError}
      </Alert>
    );
  }
  if (pending === null) return null;
  if (pending.length === 0 && doneCount === 0) return null;

  return (
    <Stack gap="xs">
      <Group>
        {pending.length > 0 ? (
          <>
            <Button variant="light" onClick={() => provision(pending)} loading={running} disabled={!snAdminUser}>
              Provision webhooks ({pending.length})
            </Button>
            <Text size="sm" c="dimmed">
              {pending.length} linked CI{pending.length === 1 ? " has" : "s have"} no PagerDuty webhook yet. Optional:
              the app creates one when the CI's first incident arrives.
            </Text>
          </>
        ) : (
          <Badge color="green" leftSection={<IconCheck size={12} />}>
            all linked CIs have webhooks
          </Badge>
        )}
        {doneCount > 0 && (
          <Badge color="green" variant="light">
            {doneCount} provisioned this run
          </Badge>
        )}
      </Group>
      {running && (
        <Text size="sm" c="dimmed">
          Running the app's webhook provisioning on ServiceNow — this waits for the scheduler and can take a minute or
          two…
        </Text>
      )}
      {failures.length > 0 && (
        <Alert color="orange" icon={<IconAlertTriangle size={16} />} title="Some webhooks weren't created">
          {failures.map((f) => (
            <Text size="sm" key={f.name}>
              {f.name}: {f.error}
            </Text>
          ))}
        </Alert>
      )}
      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Webhook provisioning failed">
          {error}
        </Alert>
      )}
    </Stack>
  );
}
