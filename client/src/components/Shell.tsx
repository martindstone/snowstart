import { useState } from "react";
import { Badge, Box, Button, Container, Group, Indicator, Loader, Menu, Modal, Stack, Tabs, Text, Title } from "@mantine/core";
import { IconAlertTriangle, IconChevronDown, IconHistory, IconPlugConnectedX } from "@tabler/icons-react";
import { useAppStore, type View } from "../store/appStore";
import { countMatchedNotLinked } from "../utils/userLinks";
import UpdateSetPanel from "./UpdateSetPanel";
import ChangesDrawer from "./ChangesDrawer";
import SetupView from "../setup/SetupView";
import ConfigurationSection from "../sections/ConfigurationSection";
import LinkUsersSection from "../sections/LinkUsersSection";
import LinkServicesSection from "../sections/LinkServicesSection";
import LinkEscalationsSection from "../sections/LinkEscalationsSection";
import VerifySection from "../sections/VerifySection";

const TABS: { value: View; label: string }[] = [
  { value: "setup", label: "Setup" },
  { value: "configuration", label: "Configuration" },
  { value: "users", label: "Link users" },
  { value: "services", label: "Link services" },
  { value: "escalations", label: "Link escalations" },
  { value: "verify", label: "Verify" },
];

const PANELS: Record<View, () => React.ReactElement> = {
  setup: () => <SetupView />,
  configuration: () => <ConfigurationSection />,
  users: () => <LinkUsersSection />,
  services: () => <LinkServicesSection />,
  escalations: () => <LinkEscalationsSection />,
  verify: () => <VerifySection />,
};

/** The app once both systems are connected: header, tabs, and the sections behind them. */
export default function Shell() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const routed = useAppStore((s) => s.routed);
  const readiness = useAppStore((s) => s.readiness);
  const readinessStatus = useAppStore((s) => s.readinessStatus);
  const readinessError = useAppStore((s) => s.readinessError);
  const bootstrap = useAppStore((s) => s.bootstrap);
  const resetSession = useAppStore((s) => s.resetSession);
  const snCreds = useAppStore((s) => s.snCreds);
  const snAdminUser = useAppStore((s) => s.snAdminUser);
  const pdConnection = useAppStore((s) => s.pdConnection);
  const updateSet = useAppStore((s) => s.updateSet);
  const updateSetSkipped = useAppStore((s) => s.updateSetSkipped);
  const changeCount = useAppStore((s) => s.changeLog.length);
  const configStatus = useAppStore((s) => s.configStatus);
  const tabCounts = useAppStore((s) => s.tabCounts);
  const matches = useAppStore((s) => s.matches);
  const defaultPdUserId = useAppStore((s) => s.defaultPdUserId);

  const [updateSetOpen, setUpdateSetOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  // Until setup is complete the other tabs can't do anything useful, so only Setup is available.
  const locked = !!readiness?.needsSetup;
  const activeView: View = locked ? "setup" : view;
  // A section is mounted the first time it's opened and then kept, so what's loaded and ticked survives tab switches.
  const [visited, setVisited] = useState<Set<View>>(new Set());
  if (!visited.has(activeView)) setVisited(new Set(visited).add(activeView));

  // Bootstrapping failed (for example the instance was unreachable): let the user retry rather than sit on a spinner.
  if (!routed) {
    return (
      <Container size={520} py="xl">
        {readinessStatus === "error" ? (
          <Stack align="flex-start">
            <Group gap="xs">
              <IconAlertTriangle size={18} />
              <Title order={4}>Couldn't check this instance</Title>
            </Group>
            <Text size="sm">{readinessError}</Text>
            <Group>
              <Button onClick={() => void bootstrap()}>Try again</Button>
              <Button variant="default" onClick={resetSession}>
                Back to connect
              </Button>
            </Group>
          </Stack>
        ) : (
          <Group>
            <Loader size="sm" />
            <Text>Checking this instance…</Text>
          </Group>
        )}
      </Container>
    );
  }

  // Hints on the tab labels: how many matches are waiting to be linked, and whether configuration is in place.
  const hintCounts: Partial<Record<View, number>> = {
    users: countMatchedNotLinked(matches, defaultPdUserId),
    services: tabCounts.services,
    escalations: tabCounts.escalations,
  };
  const configColor =
    !configStatus || (configStatus.views === "unknown" && configStatus.priorities === "unknown")
      ? undefined
      : configStatus.views === "todo" || configStatus.priorities === "todo"
        ? "orange"
        : "green";
  const setupColor = !readiness ? "gray" : readiness.allOk ? "green" : readiness.needsSetup ? "orange" : "yellow";
  const host = snCreds?.instanceUrl.replace(/^https:\/\//, "");

  return (
    <Box>
      <Box px="md" py="xs" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <Group justify="space-between" gap="sm">
          <Group gap="xs">
            <Title order={4}>SnowStart</Title>
            <Text c="dimmed" size="sm" visibleFrom="sm">
              PagerDuty ↔ ServiceNow
            </Text>
          </Group>
          <Group gap="xs">
            <Badge
              variant="outline"
              color={updateSet ? "grape" : updateSetSkipped ? "gray" : "orange"}
              style={{ cursor: "pointer", textTransform: "none" }}
              onClick={() => setUpdateSetOpen(true)}
              title="Choose the update set that captures configuration changes"
            >
              {updateSet ? `Update set: ${updateSet.name}` : updateSetSkipped ? "No update set" : "Choose an update set"}
            </Badge>
            <Button variant="default" size="compact-sm" leftSection={<IconHistory size={14} />} onClick={() => setChangesOpen(true)}>
              Changes{changeCount > 0 ? ` (${changeCount})` : ""}
            </Button>
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Button variant="subtle" size="compact-sm" rightSection={<IconChevronDown size={14} />}>
                  {host}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>
                  ServiceNow: {snAdminUser?.user_name}
                  <br />
                  PagerDuty: {pdConnection?.tokenType === "user" ? pdConnection.user?.name : "account-level token"}
                </Menu.Label>
                <Menu.Divider />
                <Menu.Item leftSection={<IconPlugConnectedX size={14} />} onClick={resetSession}>
                  Disconnect and start over
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </Box>

      <Container size="lg" py="md">
        {/* display-none, not Mantine's default Activity: Activity tears effects down while a panel is hidden, so every section would
            reload its data each time you came back to it. */}
        <Tabs value={activeView} onChange={(v) => v && setView(v as View)} keepMounted keepMountedMode="display-none">
          <Tabs.List mb="md" style={{ flexWrap: "nowrap", overflowX: "auto" }}>
            {TABS.map((t) => (
              <Tabs.Tab key={t.value} value={t.value} disabled={locked && t.value !== "setup"} style={{ flexShrink: 0 }}>
                {t.value === "setup" ? (
                  <Indicator color={setupColor} size={8} offset={-4} position="middle-end" processing={readinessStatus === "loading"}>
                    <Box pr={14}>{t.label}</Box>
                  </Indicator>
                ) : t.value === "configuration" && configColor ? (
                  <Indicator color={configColor} size={8} offset={-4} position="middle-end">
                    <Box pr={14}>{t.label}</Box>
                  </Indicator>
                ) : (
                  <Group gap={6} wrap="nowrap">
                    {t.label}
                    {!locked && !!hintCounts[t.value] && (
                      <Badge size="xs" circle={hintCounts[t.value]! < 10} variant="light" color="blue">
                        {hintCounts[t.value]}
                      </Badge>
                    )}
                  </Group>
                )}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          {TABS.map((t) => (
            <Tabs.Panel key={t.value} value={t.value}>
              {visited.has(t.value) && PANELS[t.value]()}
            </Tabs.Panel>
          ))}
        </Tabs>
      </Container>

      <Modal opened={updateSetOpen} onClose={() => setUpdateSetOpen(false)} title="Update set" size="lg">
        <UpdateSetPanel onDone={() => setUpdateSetOpen(false)} />
      </Modal>
      <ChangesDrawer opened={changesOpen} onClose={() => setChangesOpen(false)} />
    </Box>
  );
}
