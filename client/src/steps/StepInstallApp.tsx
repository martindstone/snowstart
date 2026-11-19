import { useRef, useState } from "react";
import { Alert, Anchor, Badge, Button, FileInput, Group, List, Progress, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconCheck, IconUpload } from "@tabler/icons-react";
import StepShell from "../components/StepShell";
import { commitUpdateSet, previewUpdateSet, uploadUpdateSet, type CicdProgress, type PreviewProblem } from "../api/install";
import { SNApiError } from "../api/servicenow";
import { flushServiceNowCache } from "../api/cacheFlush";
import { currentAdminId, currentSnCreds, snRecordLink, useWizardStore } from "../store/wizardStore";

type Stage = "idle" | "uploading" | "previewing" | "committing" | "flushing" | "done";

const STAGE_LABEL: Record<Exclude<Stage, "idle" | "done">, string> = {
  uploading: "Uploading the update set XML",
  previewing: "Previewing (ServiceNow checks the update set for conflicts)",
  committing: "Committing (installing the app)",
  flushing: "Clearing ServiceNow's cache",
};

export default function StepInstallApp() {
  const snScope = useWizardStore((s) => s.snScope);
  const setSnScope = useWizardStore((s) => s.setSnScope);
  const logChange = useWizardStore((s) => s.logChange);
  const snCreds = useWizardStore((s) => s.snCreds);

  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState<CicdProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<PreviewProblem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const remote = useRef<{ id: string; name: string; previewed: boolean } | null>(null);

  const installed = !!snScope;
  const busy = stage !== "idle" && stage !== "done";

  const run = async () => {
    if (!file) return;
    setError(null);
    setProblems([]);
    try {
      const creds = currentSnCreds();

      if (!remote.current) {
        setStage("uploading");
        setProgress(null);
        const uploaded = await uploadUpdateSet(creds, file);
        remote.current = { id: uploaded.remoteUpdateSetId, name: uploaded.name, previewed: false };
        logChange({
          system: "servicenow",
          table: "sys_remote_update_set",
          recordId: uploaded.remoteUpdateSetId,
          description: `Uploaded update set "${uploaded.name}" (v${uploaded.version}, scope ${uploaded.scope})`,
          link: snRecordLink(creds.instanceUrl, "sys_remote_update_set", uploaded.remoteUpdateSetId),
        });
      }

      if (!remote.current.previewed) {
        setStage("previewing");
        setProgress(null);
        const found = await previewUpdateSet(creds, remote.current.id, setProgress);
        if (found.length > 0) {
          setProblems(found);
          setStage("idle");
          return;
        }
        remote.current.previewed = true;
      }

      setStage("committing");
      setProgress(null);
      const { scope, warnings: commitWarnings } = await commitUpdateSet(creds, remote.current.id, setProgress);
      setWarnings(commitWarnings);
      logChange({
        system: "servicenow",
        table: "sys_remote_update_set",
        recordId: remote.current.id,
        description: `Installed ${scope.name} v${scope.version} (scope ${scope.scope}) from update set "${remote.current.name}"`,
        link: snRecordLink(creds.instanceUrl, "sys_remote_update_set", remote.current.id),
      });
      setSnScope(scope);
      // PagerDuty's guide: clear the cache after install so the app's cross-scope access isn't served stale.
      try {
        setStage("flushing");
        setProgress(null);
        await flushServiceNowCache(creds, currentAdminId());
        logChange({
          system: "servicenow",
          table: "sysauto_script",
          recordId: "gs.invalidateCache",
          description: "Cleared ServiceNow's cache (gs.invalidateCache) after installing the app",
        });
      } catch (flushError) {
        setWarnings((w) => [...w, `Couldn't clear ServiceNow's cache: ${flushError instanceof Error ? flushError.message : "unknown error"}. If the health check later reports cross-scope errors, run gs.invalidateCache() in Scripts – Background (Global scope).`]);
      }
      setStage("done");
    } catch (e) {
      setError(e instanceof SNApiError ? e.message : e instanceof Error ? e.message : "Install failed");
      setStage("idle");
    }
  };

  return (
    <StepShell
      title="Install the PagerDuty app"
      description="Sideloads the PagerDuty app from an update set XML export, using ServiceNow's own preview and commit."
      nextDisabled={!installed || busy}
    >
      <Stack maw={560}>
        {installed && (
          <Alert color="green" icon={<IconCheck size={16} />} title="PagerDuty app installed">
            {snScope.name} v{snScope.version} (scope <code>{snScope.scope}</code>).
            {stage === "flushing" ? " Clearing ServiceNow's cache (about 20 seconds)…" : stage !== "done" && " Nothing to do here — continue."}
          </Alert>
        )}

        {!installed && (
          <>
            <Text size="sm">
              The PagerDuty app isn't on this instance yet. Choose the update set XML (for example{" "}
              <code>pagerduty-v8.4.2.xml</code>) and install it. The preview and commit typically take several
              minutes between them — keep this tab open.
            </Text>
            <FileInput
              label="Update set XML"
              placeholder="Choose the exported update set .xml"
              accept=".xml,text/xml,application/xml"
              leftSection={<IconUpload size={16} />}
              value={file}
              onChange={setFile}
              disabled={busy}
              clearable
            />
            <Group>
              <Button onClick={run} loading={busy} disabled={!file}>
                {remote.current ? "Resume install" : "Install"}
              </Button>
              {busy && <Badge color="blue">{STAGE_LABEL[stage as keyof typeof STAGE_LABEL]}</Badge>}
            </Group>

            {busy && (
              <Stack gap={4}>
                <Progress value={progress?.percent_complete ?? 0} animated={stage !== "uploading"} />
                <Text size="xs" c="dimmed">
                  {STAGE_LABEL[stage as keyof typeof STAGE_LABEL]}
                  {progress ? ` — ${progress.percent_complete}%` : "…"}
                </Text>
              </Stack>
            )}
          </>
        )}

        {warnings.length > 0 && (
          <Alert color="yellow" icon={<IconAlertTriangle size={16} />} title="Installed, with commit warnings">
            ServiceNow reported {warnings.length} update{warnings.length === 1 ? "" : "s"} it couldn't apply. The app is installed;
            these are usually harmless leftovers from the export (for example a role grant for a user that isn't on this instance).
            <List size="xs" mt="xs">
              {warnings.map((w) => (
                <List.Item key={w}>{w}</List.Item>
              ))}
            </List>
          </Alert>
        )}

        {problems.length > 0 && (
          <Alert color="orange" icon={<IconAlertTriangle size={16} />} title={`Preview found ${problems.length} problem(s)`}>
            <List size="sm" spacing={4}>
              {problems.map((p) => (
                <List.Item key={p.sys_id}>{p.description || p.type || p.sys_id}</List.Item>
              ))}
            </List>
            <Text size="sm" mt="xs">
              Resolve them on the retrieved update set in ServiceNow
              {remote.current && snCreds && (
                <>
                  {" "}
                  (<Anchor href={snRecordLink(snCreds.instanceUrl, "sys_remote_update_set", remote.current.id)} target="_blank">
                    open it
                  </Anchor>
                  )
                </>
              )}
              , then click Resume install.
            </Text>
          </Alert>
        )}

        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Install failed">
            {error}
            {remote.current && " Your progress is kept — Resume install picks up from the stage that failed."}
          </Alert>
        )}
      </Stack>
    </StepShell>
  );
}
