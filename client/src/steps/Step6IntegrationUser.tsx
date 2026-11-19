import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  CopyButton,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconAlertTriangle, IconCheck, IconRefresh } from "@tabler/icons-react";
import StepShell from "../components/StepShell";
import {
  SNApiError,
  assignRole,
  createRecord,
  getRoleSysId,
  getTablePage,
  hasRole,
  setProperty,
  updateRecord,
} from "../api/servicenow";
import { PDApiError, deleteWebhookSubscription, getAllWebhookSubscriptions } from "../api/pagerduty";
import { SN_FIELDS, SN_INTEGRATION_USER_ROLES, SN_PROPERTIES, SN_TABLES } from "../config/schema";
import { currentPdCreds, currentAdminId, currentSnCreds, snRecordLink, useWizardStore } from "../store/wizardStore";
import { generatePassword } from "../utils/password";
import { applyIntegrationPassword } from "../api/userPassword";
import { ensureWebhookProcessors } from "../api/webhookProcessing";
import { ensureWorkflowConnection } from "../api/workflowConnection";
import { detectExistingConfig, type ExistingConfig } from "../api/existingConfig";
import type { SNUser } from "../types/servicenow";
import type { PDWebhookSubscription } from "../types/pagerduty";

type WebhookRowStatus = "idle" | "deleting" | "done" | "error";

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

export default function Step6IntegrationUser() {
  const pdUsers = useWizardStore((s) => s.pdUsers);
  const directoryStatus = useWizardStore((s) => s.directoryStatus);
  const pdServices = useWizardStore((s) => s.pdServices);
  const integrationUser = useWizardStore((s) => s.integrationUser);
  const defaultPdUserId = useWizardStore((s) => s.defaultPdUserId);
  const setIntegrationUser = useWizardStore((s) => s.setIntegrationUser);
  const loadDirectory = useWizardStore((s) => s.loadDirectory);
  const logChange = useWizardStore((s) => s.logChange);
  const [detected, setDetected] = useState<ExistingConfig | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [detectNonce, setDetectNonce] = useState(0);
  const [creating, setCreating] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [justReset, setJustReset] = useState(false);

  const [webhookSubs, setWebhookSubs] = useState<PDWebhookSubscription[]>([]);
  const [webhookSearching, setWebhookSearching] = useState(false);
  const [webhookSearchDone, setWebhookSearchDone] = useState(false);
  const [webhookSearchError, setWebhookSearchError] = useState<string | null>(null);
  const [selectedWebhookIds, setSelectedWebhookIds] = useState<Set<string>>(new Set());
  const [webhookRowStatus, setWebhookRowStatus] = useState<Record<string, WebhookRowStatus>>({});
  const [deletingWebhooks, setDeletingWebhooks] = useState(false);
  const [webhookDeleteError, setWebhookDeleteError] = useState<string | null>(null);

  const form = useForm({
    initialValues: {
      userName: "pagerduty.integration",
      firstName: "PagerDuty",
      lastName: "Integration",
      email: "",
      password: generatePassword(),
      pdUserId: defaultPdUserId ?? "",
      createPdUser: false,
    },
    validate: {
      userName: (v) => (v ? null : "Required"),
      email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : "Must be a valid email"),
      pdUserId: (v) => (v ? null : "Choose the default PagerDuty user in Base Settings first"),
    },
  });

  // The integration account is linked to the default PagerDuty user chosen in Base Settings (the health check
  // requires the two to match, and its email has to match too), so there's nothing to pick here.
  const linkedPdUser = pdUsers.find((u) => u.id === defaultPdUserId);
  useEffect(() => {
    if (!linkedPdUser) return;
    form.setFieldValue("pdUserId", linkedPdUser.id);
    form.setFieldValue("email", linkedPdUser.email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedPdUser?.id, linkedPdUser?.email]);

  // Recognise an integration account the app is already using (named by its sn_auth_user property).
  useEffect(() => {
    if (integrationUser) return;
    let cancelled = false;
    setDetectError(null);
    detectExistingConfig(currentSnCreds())
      .then((cfg) => {
        if (cancelled) return;
        setDetected(cfg);
        const u = cfg.integrationUser;
        if (u) {
          form.setFieldValue("userName", u.user_name);
          form.setFieldValue("firstName", u.first_name || "PagerDuty");
          form.setFieldValue("lastName", u.last_name || "Integration");
        } else if (cfg.snAuthUser) {
          form.setFieldValue("userName", cfg.snAuthUser);
        }
      })
      .catch((e) => {
        if (!cancelled) setDetectError(e instanceof Error ? e.message : "Couldn't read the existing configuration");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectNonce]);

  const existingUser = detected?.integrationUser ?? null;
  const detecting = !integrationUser && !detected && !detectError;
  const showExistingPanel = !integrationUser && !!existingUser && !showForm;
  // What stops the existing account being used as is. "Fix and use" resolves all of these but the last two notes.
  const problems: string[] = [];
  const notes: string[] = [];
  if (existingUser && detected) {
    if (existingUser.active !== "true") problems.push("The account is inactive.");
    if (!defaultPdUserId) {
      problems.push("No default PagerDuty user is known yet — set it in Base Settings.");
    } else if (existingUser.x_pd_integration_pagerduty_id !== defaultPdUserId) {
      const other = pdUsers.find((u) => u.id === existingUser.x_pd_integration_pagerduty_id);
      problems.push(
        `It's linked to ${other ? other.name : existingUser.x_pd_integration_pagerduty_id || "no PagerDuty user"}, not the default user${linkedPdUser ? ` (${linkedPdUser.name})` : ""} — the health check requires them to match.`,
      );
    } else if (linkedPdUser && existingUser.email.toLowerCase() !== linkedPdUser.email.toLowerCase()) {
      problems.push(`Its email (${existingUser.email}) differs from the PagerDuty user's (${linkedPdUser.email}).`);
    }
    if (detected.processors.active < 5 || detected.processors.runningAsIntegrationUser < detected.processors.active) {
      problems.push(
        `Async webhook processing isn't fully set up (${detected.processors.runningAsIntegrationUser} of 5 processor jobs run as this account).`,
      );
    }
    if (detected.processingMode === "sync") problems.push("Webhook processing mode is still synchronous.");
    if (!detected.snAuthUserPwdSet)
      notes.push("The app has no stored password for this account — use Reset password after continuing.");
    if (!detected.connectionId) notes.push("No PagerDuty workflow connection is recorded — Reset password creates it.");
  }

  const useExisting = () => {
    if (!existingUser || !linkedPdUser) return;
    setIntegrationUser({ snUser: existingUser, password: null, linkedPdUser, isExisting: true });
    void loadDirectory();
  };

  const handleCreate = async () => {
    const result = form.validate();
    if (result.hasErrors) return;
    setCreating(true);
    setError(null);
    try {
      const creds = currentSnCreds();

      // Profile fields only — deliberately excludes the password. PagerDuty's
      // own webhook subscriptions bake this account's *current* password into
      // their Authorization header at creation time and never refresh it, so
      // changing the password on an account that already has live webhooks
      // would silently break delivery until manually re-authorized.
      const profileFields = {
        first_name: form.values.firstName,
        last_name: form.values.lastName,
        email: form.values.email,
        active: true,
        [SN_FIELDS.sysUser.webServiceAccessOnly]: true,
        [SN_FIELDS.sysUser.internalIntegrationUser]: true,
      };

      let snUser: SNUser;
      let isNewUser = true;
      try {
        snUser = await createRecord<SNUser>(creds, SN_TABLES.sysUser, {
          user_name: form.values.userName,
          ...profileFields,
          // No user_password here: the Table API would store it unhashed. It's applied below.
        });
        logChange({
          system: "servicenow",
          table: SN_TABLES.sysUser,
          recordId: snUser.sys_id,
          description: `Created integration user ${snUser.user_name}`,
          link: snRecordLink(creds.instanceUrl, "sys_user", snUser.sys_id),
        });
      } catch (createError) {
        // Most likely a duplicate user_name (e.g. a leftover from a prior
        // run) — fall back to updating that existing account instead of
        // leaving the wizard stuck with no way forward.
        const existing = await getTablePage<SNUser>(creds, SN_TABLES.sysUser, {
          sysparm_query: `user_name=${form.values.userName}`,
          sysparm_limit: 1,
          sysparm_fields: "sys_id,user_name",
        });
        if (!existing[0]) throw createError;
        isNewUser = false;
        snUser = await updateRecord<SNUser>(creds, SN_TABLES.sysUser, existing[0].sys_id, profileFields);
        logChange({
          system: "servicenow",
          table: SN_TABLES.sysUser,
          recordId: snUser.sys_id,
          description: `A user named "${form.values.userName}" already existed — updated its profile fields and left its password / webhook auth untouched to avoid breaking any PagerDuty webhook subscriptions already configured against it`,
          link: snRecordLink(creds.instanceUrl, "sys_user", snUser.sys_id),
        });
      }

      const updated = await updateRecord<SNUser>(creds, SN_TABLES.sysUser, snUser.sys_id, {
        [SN_FIELDS.sysUser.pagerdutyId]: form.values.pdUserId,
      });

      for (const roleName of SN_INTEGRATION_USER_ROLES) {
        const roleSysId = await getRoleSysId(creds, roleName);
        if (!roleSysId) {
          throw new SNApiError(404, `Role "${roleName}" not found on this instance — is the PD app fully installed?`);
        }
        if (!(await hasRole(creds, snUser.sys_id, roleSysId))) {
          await assignRole(creds, snUser.sys_id, roleSysId);
        }
      }
      logChange({
        system: "servicenow",
        table: "sys_user_has_role",
        recordId: snUser.sys_id,
        description: `Granted roles: ${SN_INTEGRATION_USER_ROLES.join(", ")}`,
      });

      if (isNewUser) {
        await setProperty(creds, SN_PROPERTIES.snAuthUser, form.values.userName);
        await setProperty(creds, SN_PROPERTIES.snAuthUserPwd, form.values.password);
        setPasswordStatus(
          "Setting the account's password (ServiceNow applies it with a short scheduled job — up to a minute or two)…",
        );
        await applyIntegrationPassword(creds, currentAdminId(), snUser.sys_id);
        logChange({
          system: "servicenow",
          table: "sys_properties",
          recordId: SN_PROPERTIES.snAuthUser,
          description: "Set the integration user's password and the PD→SN webhook basic auth credentials to match",
        });
      }

      // The app's health check is supposed to create the async webhook processors but is blocked by
      // cross-scope policy on newer releases, so do it here. Not fatal: the health check reports any gap.
      try {
        setPasswordStatus("Setting up async webhook processing…");
        const { jobs, modeChanged } = await ensureWebhookProcessors(creds, snUser.sys_id);
        const touched = jobs.filter((j) => j.action !== "unchanged");
        if (touched.length > 0 || modeChanged) {
          logChange({
            system: "servicenow",
            table: "sysauto_script",
            recordId: touched[0]?.sysId ?? "webhook_processing_mode",
            description: `Set up async webhook processing: ${touched.map((j) => `${j.action} "${j.name}"`).join(", ") || "jobs already in place"}${modeChanged ? "; switched webhook processing mode to async_multi" : ""}`,
          });
        }
      } catch (e) {
        setError(
          `Integration user is ready, but async webhook processing couldn't be set up: ${e instanceof Error ? e.message : "unknown error"}`,
        );
      }

      // PagerDuty's Workflow connection stores this account's credentials, so create/refresh it now that the
      // password is final. Only possible for a new account: an existing one keeps a password we don't know.
      if (isNewUser) {
        try {
          setPasswordStatus("Creating the PagerDuty workflow connection…");
          const conn = await ensureWorkflowConnection(creds, currentPdCreds(), {
            userName: form.values.userName,
            password: form.values.password,
          });
          logChange({
            system: "pagerduty",
            table: "workflow_connection",
            recordId: conn.id,
            description: `${conn.action === "created" ? "Created" : "Updated"} PagerDuty workflow connection "${conn.name}" with the integration user's credentials and stored its id in x_pd_integration.connection_id`,
          });
        } catch (e) {
          setError(
            `Integration user is ready, but the PagerDuty workflow connection couldn't be set up: ${e instanceof Error ? e.message : "unknown error"}. Clicking Save on the PagerDuty Settings page will create it.`,
          );
        }
      }

      const pdUser = pdUsers.find((u) => u.id === form.values.pdUserId);
      if (pdUser) {
        setIntegrationUser({
          snUser: updated,
          password: isNewUser ? form.values.password : null,
          linkedPdUser: pdUser,
          isExisting: !isNewUser,
        });
        // The user directory was pulled before this account existed; refresh it so the link step sees it.
        void loadDirectory();
      }
    } catch (e) {
      setError(
        e instanceof SNApiError ? e.message : e instanceof Error ? e.message : "Failed to create integration user",
      );
    } finally {
      setCreating(false);
      setPasswordStatus(null);
    }
  };

  const handleResetPassword = async () => {
    if (!integrationUser) return;
    setResetting(true);
    setResetError(null);
    try {
      const creds = currentSnCreds();
      const newPassword = generatePassword();
      await setProperty(creds, SN_PROPERTIES.snAuthUser, integrationUser.snUser.user_name);
      await setProperty(creds, SN_PROPERTIES.snAuthUserPwd, newPassword);
      setPasswordStatus(
        "Setting the account's password (ServiceNow applies it with a short scheduled job — up to a minute or two)…",
      );
      await applyIntegrationPassword(creds, currentAdminId(), integrationUser.snUser.sys_id);
      try {
        setPasswordStatus("Updating the PagerDuty workflow connection with the new password…");
        const conn = await ensureWorkflowConnection(creds, currentPdCreds(), {
          userName: integrationUser.snUser.user_name,
          password: newPassword,
        });
        logChange({
          system: "pagerduty",
          table: "workflow_connection",
          recordId: conn.id,
          description: `${conn.action === "created" ? "Created" : "Updated"} PagerDuty workflow connection "${conn.name}" with the new password`,
        });
      } catch (connError) {
        setResetError(
          `Password reset, but the PagerDuty workflow connection couldn't be updated: ${connError instanceof Error ? connError.message : "unknown error"}. Click Save on the PagerDuty Settings page to refresh it.`,
        );
      }
      logChange({
        system: "servicenow",
        table: "sys_properties",
        recordId: SN_PROPERTIES.snAuthUser,
        description: `Reset the password for ${integrationUser.snUser.user_name} and updated the webhook basic auth credentials to match`,
      });
      setIntegrationUser({ ...integrationUser, password: newPassword, isExisting: false });
      setJustReset(true);
    } catch (e) {
      setResetError(e instanceof SNApiError ? e.message : e instanceof Error ? e.message : "Failed to reset password");
    } finally {
      setResetting(false);
      setPasswordStatus(null);
    }
  };

  const resolveServiceName = (id: string) => pdServices.find((s) => s.id === id)?.name ?? id;

  const handleFindWebhooks = async () => {
    setWebhookSearching(true);
    setWebhookSearchError(null);
    try {
      const pdCreds = currentPdCreds();
      const creds = currentSnCreds();
      const all = await getAllWebhookSubscriptions(pdCreds);
      const instanceHost = hostOf(creds.instanceUrl);
      const matches = all.filter((sub) => hostOf(sub.delivery_method?.url) === instanceHost);
      setWebhookSubs(matches);
      setSelectedWebhookIds(new Set(matches.map((m) => m.id)));
      setWebhookRowStatus({});
      setWebhookSearchDone(true);
    } catch (e) {
      setWebhookSearchError(
        e instanceof PDApiError ? e.message : e instanceof Error ? e.message : "Failed to search webhook subscriptions",
      );
    } finally {
      setWebhookSearching(false);
    }
  };

  const toggleWebhook = (id: string) => {
    setSelectedWebhookIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteSelectedWebhooks = async () => {
    if (selectedWebhookIds.size === 0) return;
    setDeletingWebhooks(true);
    setWebhookDeleteError(null);
    const pdCreds = currentPdCreds();
    const nextStatus = { ...webhookRowStatus };

    for (const id of selectedWebhookIds) {
      nextStatus[id] = "deleting";
      setWebhookRowStatus({ ...nextStatus });
      try {
        await deleteWebhookSubscription(pdCreds, id);
        nextStatus[id] = "done";
        const sub = webhookSubs.find((s) => s.id === id);
        logChange({
          system: "pagerduty",
          recordId: id,
          description: `Deleted stale PagerDuty webhook subscription${
            sub?.filter ? ` for service "${resolveServiceName(sub.filter.id)}"` : ""
          } pointing to this ServiceNow instance — its Webhooks Health Check will recreate it with the current credentials`,
        });
      } catch (e) {
        nextStatus[id] = "error";
        setWebhookDeleteError(
          e instanceof PDApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Failed to delete a webhook subscription",
        );
      }
      setWebhookRowStatus({ ...nextStatus });
    }
    setDeletingWebhooks(false);
  };

  // Offered unconditionally, not just on the existing-user/reset paths: even
  // a brand-new user gets a freshly generated password every run, so any PD
  // webhook subscription already pointing at this instance from an earlier
  // attempt — one we have no other way of knowing about — is just as likely
  // to be stale.
  const showWebhookCleanup = !!integrationUser;

  return (
    <StepShell
      title="Create the ServiceNow integration user"
      description="This account authenticates PagerDuty's calls into ServiceNow."
      nextDisabled={!integrationUser}
    >
      <Stack maw={480}>
        {detecting && <Text c="dimmed">Checking for an existing integration user…</Text>}

        {detectError && (
          <Alert
            color="orange"
            icon={<IconAlertTriangle size={16} />}
            title="Couldn't check for an existing integration user"
          >
            <Stack gap="xs">
              <Text size="sm">{detectError}</Text>
              <Text size="sm" c="dimmed">
                Retry before creating anything: if an integration user already exists, creating one here would only
                update it.
              </Text>
              <Group>
                <Button size="xs" variant="default" onClick={() => setDetectNonce((n) => n + 1)}>
                  Retry check
                </Button>
              </Group>
            </Stack>
          </Alert>
        )}

        {showExistingPanel && existingUser && detected && (
          <Alert
            color={problems.length ? "yellow" : "green"}
            icon={problems.length ? <IconAlertTriangle size={16} /> : <IconCheck size={16} />}
            title={`Existing integration user: ${existingUser.user_name}`}
          >
            <Stack gap="xs">
              <Text size="sm">
                The app is already set up to authenticate as this account
                {linkedPdUser ? `, and the default PagerDuty user is ${linkedPdUser.name}` : ""}.
              </Text>
              {problems.length === 0 ? (
                <Text size="sm">
                  Nothing needs changing: it's linked to the default user, and async processing is in place.
                </Text>
              ) : (
                <>
                  <Text size="sm">Needs attention:</Text>
                  {problems.map((p) => (
                    <Text size="sm" key={p}>
                      • {p}
                    </Text>
                  ))}
                </>
              )}
              {notes.map((n) => (
                <Text size="sm" c="dimmed" key={n}>
                  Note: {n}
                </Text>
              ))}
              <Group>
                {problems.length === 0 ? (
                  <Button size="xs" onClick={useExisting} disabled={!linkedPdUser}>
                    Use this account
                  </Button>
                ) : (
                  <Button size="xs" onClick={handleCreate} loading={creating} disabled={!linkedPdUser}>
                    Fix and use
                  </Button>
                )}
                <Button size="xs" variant="default" onClick={() => setShowForm(true)}>
                  Reconfigure…
                </Button>
              </Group>
              <Text size="xs" c="dimmed">
                The password is never changed here. Using or fixing the account leaves it as it is, so existing
                PagerDuty webhooks keep working.
              </Text>
            </Stack>
          </Alert>
        )}

        {!showExistingPanel && !detecting && (
          <>
            <TextInput label="Username" disabled={!!integrationUser} {...form.getInputProps("userName")} />
            <Group grow>
              <TextInput label="First name" disabled={!!integrationUser} {...form.getInputProps("firstName")} />
              <TextInput label="Last name" disabled={!!integrationUser} {...form.getInputProps("lastName")} />
            </Group>
            <TextInput
              label="Email"
              description="Taken from the linked PagerDuty user's login email — the health check requires the two to match."
              disabled={!!integrationUser}
              readOnly
              {...form.getInputProps("email")}
            />

            <Group align="end">
              <TextInput
                style={{ flex: 1 }}
                label="Password"
                disabled={!!integrationUser}
                placeholder={integrationUser && !integrationUser.password ? "Unknown — left untouched" : undefined}
                value={integrationUser ? (integrationUser.password ?? "") : form.values.password}
                onChange={(e) => form.setFieldValue("password", e.currentTarget.value)}
              />
              {!integrationUser && (
                <Button
                  variant="light"
                  leftSection={<IconRefresh size={16} />}
                  onClick={() => form.setFieldValue("password", generatePassword())}
                >
                  Regenerate
                </Button>
              )}
              {integrationUser?.password && (
                <CopyButton value={integrationUser.password}>
                  {({ copied, copy }) => (
                    <Button variant="light" onClick={copy}>
                      {copied ? "Copied" : "Copy password"}
                    </Button>
                  )}
                </CopyButton>
              )}
            </Group>

            <TextInput
              label="Linked PagerDuty user"
              description="The default PagerDuty user from Base Settings — the integration account acts as this user, and the health check requires them to match."
              value={linkedPdUser ? `${linkedPdUser.name} (${linkedPdUser.email})` : ""}
              placeholder={
                directoryStatus === "loading"
                  ? "Loading PagerDuty users…"
                  : "Choose the default PagerDuty user in Base Settings first"
              }
              error={form.errors.pdUserId}
              readOnly
            />

            <Group>
              {!integrationUser && (
                <Button onClick={handleCreate} loading={creating} variant="light">
                  Create integration user
                </Button>
              )}
              {integrationUser && (
                <Badge color="green" leftSection={<IconCheck size={14} />}>
                  {integrationUser.isExisting ? "Using existing user" : "Created"} {integrationUser.snUser.user_name}
                </Badge>
              )}
              {integrationUser && (
                <Button
                  variant="light"
                  color="orange"
                  leftSection={<IconRefresh size={16} />}
                  onClick={handleResetPassword}
                  loading={resetting}
                >
                  Reset password
                </Button>
              )}
            </Group>
          </>
        )}

        {passwordStatus && (
          <Text size="sm" c="dimmed">
            {passwordStatus}
          </Text>
        )}

        {integrationUser?.isExisting && !justReset && (
          <Alert color="blue" title="Existing account reused">
            This account already existed, so its password (and the matching PD→SN webhook auth) were left exactly as
            they were — changing them here would break any PagerDuty webhook subscriptions already configured against
            it. Only use "Reset password" if you specifically need to rotate it (see the warning that appears after, and
            the cleanup tool below).
          </Alert>
        )}

        {integrationUser?.password && !justReset && (
          <Alert color="yellow" title="Password shown once">
            Copy it now if you need it outside this session — it isn't stored anywhere but here.
          </Alert>
        )}

        {justReset && (
          <Alert
            color="orange"
            icon={<IconAlertTriangle size={16} />}
            title="Password rotated — webhooks need re-authorizing"
          >
            <Text size="sm">
              The ServiceNow login and the PD→SN webhook auth property now match the new password above. Any PagerDuty
              webhook subscription already created for a linked service or escalation policy still has the <em>old</em>{" "}
              password baked into its Authorization header, and PagerDuty never refreshes that on its own — those
              deliveries will 401 until re-authorized. ServiceNow's Webhooks Health Check only rebuilds that header when
              it thinks the subscription is <em>missing</em>, so use the tool below to delete the stale subscription(s)
              on the PagerDuty side, then re-run the Webhooks Health Check to have it recreate them with the current
              password.
            </Text>
          </Alert>
        )}

        {resetError && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Failed to reset password">
            {resetError}
          </Alert>
        )}

        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Failed">
            {error}
          </Alert>
        )}
      </Stack>

      {showWebhookCleanup && (
        <Paper withBorder p="md" radius="md" mt="lg" maw={720}>
          <Title order={5} mb={4}>
            Stale PagerDuty webhook subscriptions
          </Title>
          <Text size="sm" c="dimmed" mb="sm">
            Any PagerDuty webhook subscription already pointing at this ServiceNow instance — from an earlier attempt, a
            reclaimed instance, or anything else you might not know about — could have an <em>old</em> credential baked
            into its Authorization header. Scan for them and delete any that are stale; ServiceNow's own Webhooks Health
            Check will then detect they're missing and recreate them fresh with the current password.
          </Text>

          {!webhookSearchDone && (
            <Button variant="light" onClick={handleFindWebhooks} loading={webhookSearching}>
              Find webhook subscriptions pointing to this instance
            </Button>
          )}

          {webhookSearchError && (
            <Alert color="red" icon={<IconAlertTriangle size={16} />} mt="sm">
              {webhookSearchError}
            </Alert>
          )}

          {webhookSearchDone && webhookSubs.length === 0 && (
            <Text size="sm" c="dimmed">
              No webhook subscriptions found pointing to this instance.
            </Text>
          )}

          {webhookSearchDone && webhookSubs.length > 0 && (
            <Stack mt="sm">
              <Group>
                <Button
                  color="red"
                  variant="light"
                  onClick={handleDeleteSelectedWebhooks}
                  loading={deletingWebhooks}
                  disabled={selectedWebhookIds.size === 0}
                >
                  Delete {selectedWebhookIds.size || ""} selected
                </Button>
                <Button variant="subtle" onClick={handleFindWebhooks} loading={webhookSearching}>
                  Re-scan
                </Button>
              </Group>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th />
                    <Table.Th>Service</Table.Th>
                    <Table.Th>Delivery URL</Table.Th>
                    <Table.Th>Status</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {webhookSubs.map((sub) => {
                    const status = webhookRowStatus[sub.id] ?? "idle";
                    return (
                      <Table.Tr key={sub.id}>
                        <Table.Td>
                          <Checkbox
                            checked={selectedWebhookIds.has(sub.id)}
                            disabled={status === "deleting" || status === "done"}
                            onChange={() => toggleWebhook(sub.id)}
                          />
                        </Table.Td>
                        <Table.Td>{sub.filter ? resolveServiceName(sub.filter.id) : "—"}</Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {sub.delivery_method?.url}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          {status === "idle" && <Text c="dimmed">—</Text>}
                          {status === "deleting" && <Badge color="blue">deleting…</Badge>}
                          {status === "done" && <Badge color="green">deleted</Badge>}
                          {status === "error" && <Badge color="red">failed</Badge>}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Stack>
          )}

          {webhookDeleteError && (
            <Alert color="red" icon={<IconAlertTriangle size={16} />} mt="sm">
              {webhookDeleteError}
            </Alert>
          )}
        </Paper>
      )}
    </StepShell>
  );
}
