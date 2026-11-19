import { useMemo, useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, Loader, ScrollArea, Stack, Table, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import Section from "../components/Section";
import { SNApiError, createRecord, updateRecord } from "../api/servicenow";
import { SN_FIELDS, SN_TABLES } from "../config/schema";
import { currentSnCreds, snRecordLink, useAppStore } from "../store/appStore";
import { splitName } from "../utils/names";
import type { SNUser } from "../types/servicenow";
import { kindOf, type UserLinkKind } from "../utils/userLinks";

type RowStatus = "idle" | "linking" | "error";

type Kind = UserLinkKind;

const KIND_ORDER: Record<Kind, number> = { link: 0, create: 1, conflict: 2, linked: 3 };
const actionable = (k: Kind) => k === "create" || k === "link";

export default function LinkUsersSection() {
  const matches = useAppStore((s) => s.matches);
  const setDirectoryData = useAppStore((s) => s.setDirectoryData);
  const snUsers = useAppStore((s) => s.snUsers);
  const pdUsers = useAppStore((s) => s.pdUsers);
  const logChange = useAppStore((s) => s.logChange);
  const loadDirectory = useAppStore((s) => s.loadDirectory);
  const directoryStatus = useAppStore((s) => s.directoryStatus);
  const directoryError = useAppStore((s) => s.directoryError);
  const defaultPdUserId = useAppStore((s) => s.defaultPdUserId);

  // Every PagerDuty user gets a row except the default user, which belongs to the integration user and is linked
  // in Setup (the directory snapshot can predate that, so it's excluded here rather than trusted to be current).
  // ServiceNow-only users have nothing to link.
  const rows = useMemo(
    () =>
      matches
        .filter((m) => m.pdUser && m.pdUser.id !== defaultPdUserId)
        .map((m) => ({ match: m, kind: kindOf(m) }))
        .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.match.email.localeCompare(b.match.email)),
    [matches, defaultPdUserId],
  );
  const defaultPdUser = pdUsers.find((u) => u.id === defaultPdUserId);
  const counts = useMemo(() => {
    const c: Record<Kind, number> = { create: 0, link: 0, linked: 0, conflict: 0 };
    rows.forEach((r) => c[r.kind]++);
    return c;
  }, [rows]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (email: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const actionableRows = rows.filter((r) => actionable(r.kind));
  const allSelected = actionableRows.length > 0 && actionableRows.every((r) => selected.has(r.match.email));
  const matchedRows = actionableRows.filter((r) => r.kind === "link");
  const matchedSelected = matchedRows.length > 0 && matchedRows.every((r) => selected.has(r.match.email));
  const selectMatched = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      matchedRows.forEach((r) => (matchedSelected ? next.delete(r.match.email) : next.add(r.match.email)));
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(actionableRows.map((r) => r.match.email)));

  const handleLink = async () => {
    const todo = actionableRows.filter((r) => selected.has(r.match.email));
    if (todo.length === 0) return;
    setLinking(true);
    setError(null);
    const creds = currentSnCreds();
    const nextStatuses: Record<string, RowStatus> = { ...statuses };
    const changed = new Map<string, SNUser>(); // email → the ServiceNow user as it now stands

    for (const { match, kind } of todo) {
      const pdUser = match.pdUser!;
      nextStatuses[match.email] = "linking";
      setStatuses({ ...nextStatuses });
      try {
        let snUser: SNUser;
        if (kind === "create") {
          const { firstName, lastName } = splitName(pdUser.name);
          snUser = await createRecord<SNUser>(creds, SN_TABLES.sysUser, {
            user_name: match.email,
            first_name: firstName,
            last_name: lastName,
            email: match.email,
            active: true,
            [SN_FIELDS.sysUser.pagerdutyId]: pdUser.id,
          });
          logChange({
            system: "servicenow",
            table: SN_TABLES.sysUser,
            recordId: snUser.sys_id,
            description: `Created ServiceNow user for PagerDuty user ${pdUser.name}, linked to PagerDuty ID ${pdUser.id}`,
            link: snRecordLink(creds.instanceUrl, "sys_user", snUser.sys_id),
          });
        } else {
          const existing = match.snUser!;
          await updateRecord(creds, SN_TABLES.sysUser, existing.sys_id, { [SN_FIELDS.sysUser.pagerdutyId]: pdUser.id });
          snUser = { ...existing, x_pd_integration_pagerduty_id: pdUser.id };
          logChange({
            system: "servicenow",
            table: SN_TABLES.sysUser,
            recordId: existing.sys_id,
            description: `Linked ServiceNow user ${existing.name || existing.user_name} to PagerDuty user ${pdUser.name} (${pdUser.id})`,
            link: snRecordLink(creds.instanceUrl, "sys_user", existing.sys_id),
          });
        }
        changed.set(match.email, snUser);
        delete nextStatuses[match.email];
      } catch (e) {
        nextStatuses[match.email] = "error";
        setError(e instanceof SNApiError ? e.message : e instanceof Error ? e.message : "Failed to link a user");
      }
      setStatuses({ ...nextStatuses });
    }

    if (changed.size > 0) {
      const updatedMatches = matches.map((m) => {
        const snUser = changed.get(m.email);
        return snUser ? { ...m, snUser, status: "matched" as const } : m;
      });
      const changedIds = new Set([...changed.values()].map((u) => u.sys_id));
      setDirectoryData([...snUsers.filter((u) => !changedIds.has(u.sys_id)), ...changed.values()], pdUsers, updatedMatches);
      setSelected((prev) => new Set([...prev].filter((email) => !changed.has(email))));
    }
    setLinking(false);
  };

  // Checked but not yet applied (or failed) — Next must not imply these took effect.
  const pendingCount = actionableRows.filter((r) => selected.has(r.match.email)).length;
  const loadingUsers = directoryStatus === "loading" || directoryStatus === "idle";

  // What the row is now.
  const renderStatus = (kind: Kind) => {
    if (kind === "linked") return <Badge color="green" variant="light">linked</Badge>;
    if (kind === "link") {
      return (
        <Badge color="teal" variant="light" title="A ServiceNow user with this email exists but isn't linked yet">
          matched
        </Badge>
      );
    }
    if (kind === "conflict") {
      return (
        <Badge color="orange" variant="light" title="This ServiceNow user already holds a different PagerDuty ID, so it won't be changed here">
          id mismatch
        </Badge>
      );
    }
    return <Text c="dimmed">—</Text>;
  };

  // What applying will do to the row; empty until it's checked.
  const renderAction = (email: string, kind: Kind) => {
    const status = statuses[email] ?? "idle";
    if (status === "linking") return <Badge color="blue">{kind === "create" ? "creating…" : "linking…"}</Badge>;
    if (status === "error") return <Badge color="red">failed</Badge>;
    if (!actionable(kind) || !selected.has(email)) return null;
    return kind === "create" ? (
      <Badge color="grape" title="A ServiceNow user will be created for this PagerDuty user">
        create
      </Badge>
    ) : (
      <Badge color="blue" title="The existing ServiceNow user will be linked to this PagerDuty user">
        link
      </Badge>
    );
  };

  return (
    <Section
      title="Link PagerDuty users to ServiceNow"
      description="PagerDuty and ServiceNow users are matched by email. Check a row to link the ServiceNow user to its PagerDuty user, or to create a ServiceNow user when there isn't one."
    >
      <Stack>
        <Group>
          <Button
            onClick={() => {
              setStatuses({});
              setSelected(new Set());
              void loadDirectory();
            }}
            loading={directoryStatus === "loading"}
            variant="default"
            size="xs"
          >
            Re-pull users
          </Button>
          {directoryStatus === "loaded" && (
            <Group gap="xs">
              <Badge color="green">{counts.linked} linked</Badge>
              <Badge color="teal">{counts.link} matched, not linked</Badge>
              <Badge color="grape">{counts.create} PagerDuty-only</Badge>
              {counts.conflict > 0 && <Badge color="orange">{counts.conflict} id mismatch</Badge>}
            </Group>
          )}
        </Group>

        {directoryStatus === "loaded" && defaultPdUser && (
          <Text size="xs" c="dimmed">
            {defaultPdUser.name} is the default user, linked to the ServiceNow integration user in Setup, so it isn't listed.
          </Text>
        )}

        {directoryStatus === "error" && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Failed to pull users">
            {directoryError}
          </Alert>
        )}

        {loadingUsers && <Text c="dimmed">Pulling users from both systems…</Text>}

        {!loadingUsers && directoryStatus === "loaded" && rows.length === 0 && (
          <Text c="dimmed">No PagerDuty users found.</Text>
        )}

        {directoryStatus === "loaded" && rows.length > 0 && (
          <>
            <Group>
              <Button onClick={handleLink} loading={linking} disabled={pendingCount === 0} variant="light">
                Apply {pendingCount || ""} selected
              </Button>
              <Button onClick={selectMatched} variant="default" disabled={linking || matchedRows.length === 0}>
                {matchedSelected ? "Deselect" : "Select"} matched ({matchedRows.length})
              </Button>
              {pendingCount > 0 && (
                <Text size="sm" c={linking ? "blue.7" : "yellow.7"}>
                  {linking
                    ? "Applying…"
                    : `${pendingCount} row${pendingCount === 1 ? "" : "s"} checked but not applied yet`}
                </Text>
              )}
            </Group>
            <ScrollArea h={380}>
              <Table stickyHeader highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>
                      <Checkbox
                        aria-label="Select all rows that need linking"
                        checked={allSelected}
                        indeterminate={!allSelected && actionableRows.some((r) => selected.has(r.match.email))}
                        disabled={actionableRows.length === 0 || linking}
                        onChange={toggleAll}
                      />
                    </Table.Th>
                    <Table.Th>PagerDuty user</Table.Th>
                    <Table.Th>Email</Table.Th>
                    <Table.Th>ServiceNow user</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Action</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map(({ match: m, kind }) => {
                    const status = statuses[m.email] ?? "idle";
                    return (
                      <Table.Tr key={m.email}>
                        <Table.Td>
                          <Checkbox
                            checked={kind === "linked" || selected.has(m.email)}
                            disabled={!actionable(kind) || status === "linking"}
                            onChange={() => toggle(m.email)}
                          />
                        </Table.Td>
                        <Table.Td>{m.pdUser?.name}</Table.Td>
                        <Table.Td>{m.email}</Table.Td>
                        <Table.Td>{m.snUser ? m.snUser.name || m.snUser.user_name : <Text c="dimmed">—</Text>}</Table.Td>
                        <Table.Td>{renderStatus(kind)}</Table.Td>
                        <Table.Td>{renderAction(m.email, kind)}</Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </>
        )}

        {pendingCount > 0 &&
          (linking ? (
            <Alert color="blue" icon={<Loader size={16} />} title="Applying changes">
              Updating {pendingCount} user{pendingCount === 1 ? "" : "s"} in ServiceNow. The table updates when it's done.
            </Alert>
          ) : (
            <Alert color="yellow" icon={<IconAlertTriangle size={16} />} title="Unapplied changes">
              {pendingCount} user{pendingCount === 1 ? " is" : "s are"} checked but not applied yet. Click "Apply selected" to
              make the changes, or uncheck {pendingCount === 1 ? "it" : "them"}.
            </Alert>
          ))}

        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Some users failed to link">
            {error}
          </Alert>
        )}
      </Stack>
    </Section>
  );
}
