import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Select, Stack, Switch, Text, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconAlertTriangle, IconCheck, IconPlus } from "@tabler/icons-react";
import CreatePdUserModal from "../components/CreatePdUserModal";
import CreatePdServiceModal from "../components/CreatePdServiceModal";
import { SNApiError, setProperty } from "../api/servicenow";
import { PDApiError, getAllServices } from "../api/pagerduty";
import { SN2PD_MAPPING_DEFAULT, SN_PROPERTIES } from "../config/schema";
import { currentPdCreds, currentSnCreds, useAppStore } from "../store/appStore";
import { derivePdInstanceUrl } from "../utils/pdUrl";

/**
 * The PD subdomain isn't exposed by every endpoint (an account-level API token has no "current user", so /users/me can't
 * supply it) — but every PD object's html_url carries it, so any already-fetched user or service works as the source.
 */
function findPdHtmlUrl(pdUsers: { html_url?: string }[], pdServices: { html_url?: string }[]): string | undefined {
  return pdUsers.find((u) => u.html_url)?.html_url ?? pdServices.find((s) => s.html_url)?.html_url;
}

/**
 * The app's default PagerDuty user and service, and the auto-provision switch. Everything else in the app's base
 * settings is derived from the connections (API key, PagerDuty URL) or fixed (CI + Assignment Group mapping), so it's
 * written alongside without asking.
 */
export default function DefaultsCard() {
  const pdUsers = useAppStore((s) => s.pdUsers);
  const directoryStatus = useAppStore((s) => s.directoryStatus);
  const pdServices = useAppStore((s) => s.pdServices);
  const setPdServices = useAppStore((s) => s.setPdServices);
  const pdConnection = useAppStore((s) => s.pdConnection);
  const pdCreds = useAppStore((s) => s.pdCreds);
  const logChange = useAppStore((s) => s.logChange);
  const setDefaultPdUserId = useAppStore((s) => s.setDefaultPdUserId);
  const integrationUser = useAppStore((s) => s.integrationUser);
  const config = useAppStore((s) => s.readiness?.config);
  const refreshReadiness = useAppStore((s) => s.refreshReadiness);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);

  const derivedUrl = derivePdInstanceUrl(pdConnection?.user?.html_url ?? findPdHtmlUrl(pdUsers, pdServices));

  const form = useForm({
    initialValues: {
      instanceUrl: config?.instanceUrl || derivedUrl,
      defaultUserId: config?.defaultUser ?? "",
      defaultServiceId: config?.defaultService ?? "",
      autoProvisionUsers: config?.autoProvisionUsers ?? false,
    },
    validate: {
      instanceUrl: (v) => (v ? null : "Required"),
      defaultUserId: (v) => (v ? null : "Required"),
      defaultServiceId: (v) => (v ? null : "Required"),
    },
  });

  // Fill the PagerDuty URL once it can be worked out, if nothing is configured yet.
  const urlSet = useRef(false);
  useEffect(() => {
    if (!urlSet.current && !form.values.instanceUrl && derivedUrl) {
      urlSet.current = true;
      form.setFieldValue("instanceUrl", derivedUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedUrl]);

  useEffect(() => {
    if (pdServices.length > 0 || !pdCreds) return;
    setServicesLoading(true);
    getAllServices(pdCreds)
      .then(setPdServices)
      .catch((e) => setError(e instanceof PDApiError ? e.message : "Couldn't load PagerDuty services"))
      .finally(() => setServicesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdCreds]);

  const handleSave = async () => {
    if (form.validate().hasErrors) return;
    setSaving(true);
    setError(null);
    try {
      const snCreds = currentSnCreds();
      const writes: [string, string][] = [
        [SN_PROPERTIES.apiKey, currentPdCreds().apiToken],
        [SN_PROPERTIES.instanceUrl, form.values.instanceUrl],
        [SN_PROPERTIES.defaultUser, form.values.defaultUserId],
        [SN_PROPERTIES.defaultService, form.values.defaultServiceId],
        [SN_PROPERTIES.autoProvisionUsers, String(form.values.autoProvisionUsers)],
        [SN_PROPERTIES.sn2pdMapping, SN2PD_MAPPING_DEFAULT],
      ];
      for (const [name, value] of writes) await setProperty(snCreds, name, value);
      logChange({
        system: "servicenow",
        table: "sys_properties",
        recordId: SN_PROPERTIES.defaultUser,
        description:
          "Applied base PagerDuty integration settings (API key, instance URL, default user/service, auto-provisioning, CI+AG mapping mode)",
      });
      setDefaultPdUserId(form.values.defaultUserId);
      setSaved(true);
      await refreshReadiness();
    } catch (e) {
      setError(e instanceof SNApiError || e instanceof PDApiError ? e.message : e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack maw={520}>
      {!derivedUrl && !config?.instanceUrl && (
        <TextInput
          label="PagerDuty instance URL"
          description="Couldn't be worked out from your PagerDuty account."
          {...form.getInputProps("instanceUrl")}
        />
      )}

      <Group align="end">
        <Select
          style={{ flex: 1 }}
          label="Default PagerDuty user"
          description={
            integrationUser
              ? "Locked: the ServiceNow integration user is linked to this PagerDuty user."
              : "Also the PagerDuty user the ServiceNow integration user is linked to (the health check requires them to match). Use a dedicated service-account user, not a person."
          }
          placeholder={directoryStatus === "loading" ? "Loading PagerDuty users…" : "Select a user"}
          searchable
          disabled={!!integrationUser}
          data={pdUsers.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
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

      <Text size="xs" c="dimmed">
        Saving also writes the API key and PagerDuty URL from your connection and sets the mapping mode to {SN2PD_MAPPING_DEFAULT} (this
        app's link sections assume it: services map to Configuration Items and escalation policies map to Assignment Groups).
      </Text>

      <Group>
        <Button onClick={handleSave} loading={saving} variant="light">
          Save defaults
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
    </Stack>
  );
}
