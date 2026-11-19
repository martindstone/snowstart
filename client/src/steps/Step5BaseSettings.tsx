import { useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Select, Stack, Switch, Table, Text, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconAlertTriangle, IconCheck, IconPlus } from "@tabler/icons-react";
import StepShell from "../components/StepShell";
import CreatePdUserModal from "../components/CreatePdUserModal";
import CreatePdServiceModal from "../components/CreatePdServiceModal";
import { SNApiError, setProperty } from "../api/servicenow";
import { PDApiError, getAllServices } from "../api/pagerduty";
import { detectExistingConfig, type ExistingConfig } from "../api/existingConfig";
import { SN2PD_MAPPING_DEFAULT, SN_PROPERTIES } from "../config/schema";
import { currentPdCreds, currentSnCreds, useWizardStore } from "../store/wizardStore";
import { derivePdInstanceUrl } from "../utils/pdUrl";

/**
 * The PD subdomain isn't exposed by every endpoint (an account-level API
 * token has no "current user", so /users/me can't supply it) — but every PD
 * object's html_url carries it, so any already-fetched user or service works
 * as the source.
 */
function findPdHtmlUrl(pdUsers: { html_url?: string }[], pdServices: { html_url?: string }[]): string | undefined {
  return pdUsers.find((u) => u.html_url)?.html_url ?? pdServices.find((s) => s.html_url)?.html_url;
}

export default function Step5BaseSettings() {
  const pdUsers = useWizardStore((s) => s.pdUsers);
  const directoryStatus = useWizardStore((s) => s.directoryStatus);
  const pdServices = useWizardStore((s) => s.pdServices);
  const setPdServices = useWizardStore((s) => s.setPdServices);
  const pdConnection = useWizardStore((s) => s.pdConnection);
  const pdCreds = useWizardStore((s) => s.pdCreds);
  const logChange = useWizardStore((s) => s.logChange);
  const defaultPdUserId = useWizardStore((s) => s.defaultPdUserId);
  const setDefaultPdUserId = useWizardStore((s) => s.setDefaultPdUserId);
  const integrationUser = useWizardStore((s) => s.integrationUser);
  const next = useWizardStore((s) => s.next);
  const [existing, setExisting] = useState<ExistingConfig | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [reconfigure, setReconfigure] = useState(false);
  const [detectNonce, setDetectNonce] = useState(0);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);

  const form = useForm({
    initialValues: {
      instanceUrl: derivePdInstanceUrl(pdConnection?.user?.html_url ?? findPdHtmlUrl(pdUsers, pdServices)),
      defaultUserId: defaultPdUserId ?? "",
      defaultServiceId: "",
      autoProvisionUsers: false,
    },
    validate: {
      instanceUrl: (v) => (v ? null : "Required"),
      defaultUserId: (v) => (v ? null : "Required"),
      defaultServiceId: (v) => (v ? null : "Required"),
    },
  });

  useEffect(() => {
    if (pdServices.length > 0 || !pdCreds) return;
    setServicesLoading(true);
    getAllServices(pdCreds)
      .then(setPdServices)
      .finally(() => setServicesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdCreds]);

  // Recognise an instance whose base settings are already in place; offer to keep them, or edit them prefilled.
  useEffect(() => {
    let cancelled = false;
    setDetectError(null);
    detectExistingConfig(currentSnCreds())
      .then((cfg) => {
        if (cancelled) return;
        setExisting(cfg);
        form.setValues({
          instanceUrl: cfg.instanceUrl || form.values.instanceUrl,
          defaultUserId: cfg.defaultUser || form.values.defaultUserId,
          defaultServiceId: cfg.defaultService || form.values.defaultServiceId,
          autoProvisionUsers: cfg.autoProvisionUsers,
        });
      })
      .catch((e) => {
        if (!cancelled) setDetectError(e instanceof Error ? e.message : "Couldn't read the existing settings");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectNonce]);

  const detecting = existing === null && !detectError;
  const keeping = !!existing?.baseConfigured && !reconfigure && !saved;
  const userLabel = (id: string) => {
    const u = pdUsers.find((x) => x.id === id);
    return u ? `${u.name} (${u.email})` : id;
  };
  const serviceLabel = (id: string) => pdServices.find((x) => x.id === id)?.name ?? id;

  const handleSave = async () => {
    const result = form.validate();
    if (result.hasErrors) return;
    setSaving(true);
    setError(null);
    try {
      const snCreds = currentSnCreds();
      const pdApiToken = currentPdCreds().apiToken;
      const writes: [string, string][] = [
        [SN_PROPERTIES.apiKey, pdApiToken],
        [SN_PROPERTIES.instanceUrl, form.values.instanceUrl],
        [SN_PROPERTIES.defaultUser, form.values.defaultUserId],
        [SN_PROPERTIES.defaultService, form.values.defaultServiceId],
        [SN_PROPERTIES.autoProvisionUsers, String(form.values.autoProvisionUsers)],
        [SN_PROPERTIES.sn2pdMapping, SN2PD_MAPPING_DEFAULT],
      ];
      for (const [name, value] of writes) {
        await setProperty(snCreds, name, value);
      }
      logChange({
        system: "servicenow",
        table: "sys_properties",
        recordId: SN_PROPERTIES.defaultUser,
        description:
          "Applied base PagerDuty integration settings (API key, instance URL, default user/service, auto-provisioning, CI+AG mapping mode)",
      });
      setDefaultPdUserId(form.values.defaultUserId);
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof SNApiError || e instanceof PDApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed to save settings",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <StepShell
      title="Base integration settings"
      nextDisabled={detecting || (!saved && !keeping)}
      onNext={() => {
        // Keeping existing settings: later steps still need to know which PagerDuty user is the default user.
        if (keeping && existing) setDefaultPdUserId(existing.defaultUser);
        next();
      }}
    >
      <Stack maw={520}>
        <Text size="sm" c="dimmed">
          Written to ServiceNow System Properties under the <code>x_pd_integration</code> scope.
        </Text>

        {detectError && (
          <Alert color="orange" icon={<IconAlertTriangle size={16} />} title="Couldn't check for existing settings">
            <Stack gap="xs">
              <Text size="sm">{detectError}</Text>
              <Group>
                <Button size="xs" variant="default" onClick={() => setDetectNonce((n) => n + 1)}>
                  Retry check
                </Button>
              </Group>
            </Stack>
          </Alert>
        )}

        {keeping && existing && (
          <Alert color="green" icon={<IconCheck size={16} />} title="Already configured">
            <Stack gap="xs">
              <Text size="sm">
                This instance already has base settings. Continue to keep them exactly as they are, or reconfigure to
                change them.
              </Text>
              <Table withRowBorders={false} verticalSpacing={2}>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td c="dimmed">PagerDuty instance URL</Table.Td>
                    <Table.Td>{existing.instanceUrl}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td c="dimmed">Default user</Table.Td>
                    <Table.Td>{userLabel(existing.defaultUser)}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td c="dimmed">Default service</Table.Td>
                    <Table.Td>{serviceLabel(existing.defaultService)}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td c="dimmed">Auto-provision users</Table.Td>
                    <Table.Td>{existing.autoProvisionUsers ? "on" : "off"}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td c="dimmed">Mapping mode</Table.Td>
                    <Table.Td>
                      {existing.mapping || "—"}{" "}
                      {existing.mapping && existing.mapping !== SN2PD_MAPPING_DEFAULT && (
                        <Badge
                          color="orange"
                          size="sm"
                          title="This wizard's link steps assume CI+AG mode; reconfigure to switch"
                        >
                          not CI+AG
                        </Badge>
                      )}
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td c="dimmed">API key</Table.Td>
                    <Table.Td>set (can't be compared with the token you connected with)</Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
              <Group>
                <Button variant="default" size="xs" onClick={() => setReconfigure(true)}>
                  Reconfigure…
                </Button>
              </Group>
            </Stack>
          </Alert>
        )}

        {existing?.baseConfigured && reconfigure && !saved && (
          <Alert color="blue" title="Editing existing settings">
            The form is prefilled with what's configured now. Saving overwrites the API key with the token you connected
            with and sets the mapping mode to CI+AG.
          </Alert>
        )}

        {detecting && <Text c="dimmed">Checking for existing settings…</Text>}

        {!keeping && !detecting && (
          <>
            <TextInput label="PagerDuty instance URL" {...form.getInputProps("instanceUrl")} />

            <Group align="end">
              <Select
                style={{ flex: 1 }}
                label="Default PagerDuty user"
                description={
                  integrationUser
                    ? "Locked: the ServiceNow integration user is already linked to this PagerDuty user."
                    : "Also the PagerDuty user the ServiceNow integration user is linked to (the health check requires them to match). Use a dedicated service-account user, not a person."
                }
                placeholder={directoryStatus === "loading" ? "Loading PagerDuty users…" : "Select a user"}
                searchable
                disabled={!!integrationUser}
                data={pdUsers.map((u) => ({
                  value: u.id,
                  label: `${u.name} (${u.email})`,
                }))}
                {...form.getInputProps("defaultUserId")}
              />
              {!integrationUser && (
                <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setUserModalOpen(true)}>
                  New
                </Button>
              )}
            </Group>

            <Group align="end">
              <Select
                style={{ flex: 1 }}
                label="Default service"
                placeholder={servicesLoading ? "Loading…" : "Select a service"}
                searchable
                disabled={servicesLoading}
                data={pdServices.map((s) => ({ value: s.id, label: s.name }))}
                {...form.getInputProps("defaultServiceId")}
              />
              <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setServiceModalOpen(true)}>
                New
              </Button>
            </Group>

            <Switch
              label="Auto-provision PagerDuty users for unmatched ServiceNow assignees"
              checked={form.values.autoProvisionUsers}
              onChange={(e) => form.setFieldValue("autoProvisionUsers", e.currentTarget.checked)}
            />

            <Text size="sm" c="dimmed">
              Mapping mode: {SN2PD_MAPPING_DEFAULT} — set explicitly on save (this wizard only supports CI+AG mode,
              services map to Configuration Items and escalation policies map to Assignment Groups)
            </Text>

            <Group>
              <Button onClick={handleSave} loading={saving} variant="light">
                Save settings
              </Button>
              {saved && (
                <Text c="green" size="sm">
                  <IconCheck size={14} style={{ verticalAlign: "middle" }} /> Saved
                </Text>
              )}
            </Group>

            {error && (
              <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Failed">
                {error}
              </Alert>
            )}
          </>
        )}
      </Stack>

      <CreatePdUserModal
        opened={userModalOpen}
        onClose={() => setUserModalOpen(false)}
        onCreated={(user) => form.setFieldValue("defaultUserId", user.id)}
      />
      <CreatePdServiceModal
        opened={serviceModalOpen}
        onClose={() => setServiceModalOpen(false)}
        onCreated={(service) => form.setFieldValue("defaultServiceId", service.id)}
      />
    </StepShell>
  );
}
