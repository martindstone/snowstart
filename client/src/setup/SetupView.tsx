import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { useAppStore } from "../store/appStore";
import SetupCard from "./SetupCard";
import TableAccessCard from "./TableAccessCard";
import InstallCard from "./InstallCard";
import DefaultsCard from "./DefaultsCard";
import IntegrationUserCard from "./IntegrationUserCard";

/**
 * Everything the PagerDuty app needs before it can be used, as a chain of cards: table access, then the app itself,
 * then its defaults, then the integration user. Each is detected from the instance, so a set-up instance shows all of
 * them as done and an empty one walks through them in order.
 */
export default function SetupView() {
  const readiness = useAppStore((s) => s.readiness);
  const status = useAppStore((s) => s.readinessStatus);
  const error = useAppStore((s) => s.readinessError);
  const refresh = useAppStore((s) => s.refreshReadiness);

  return (
    <Stack gap="sm" maw={820}>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {readiness?.allOk
            ? "This instance is set up. Open a card to review or change it."
            : "Work down the list. Each step unlocks when the one before it is done, and the other tabs unlock when setup is complete."}
        </Text>
        <Button variant="default" size="compact-sm" leftSection={<IconRefresh size={14} />} loading={status === "loading"} onClick={() => void refresh()}>
          Re-check
        </Button>
      </Group>
      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Couldn't check this instance">
          {error}
        </Alert>
      )}
      <SetupCard
        id="access"
        title="Table access"
        description="The app runs in its own scope but reads and writes these global tables, so their Application Access settings have to allow it (step 1.1 of PagerDuty's guide)."
      >
        <TableAccessCard />
      </SetupCard>
      <SetupCard
        id="install"
        title="PagerDuty app"
        description="Sideloads the PagerDuty app from an update set XML export, using ServiceNow's own preview and commit."
      >
        <InstallCard />
      </SetupCard>
      <SetupCard
        id="defaults"
        title="Defaults"
        description="The default PagerDuty user and service, and whether to auto-provision users. The API key and PagerDuty URL come from your connection."
      >
        <DefaultsCard />
      </SetupCard>
      <SetupCard
        id="integration"
        title="Integration user"
        description="The ServiceNow account PagerDuty authenticates as, linked to the default PagerDuty user, with async webhook processing."
      >
        <IntegrationUserCard />
      </SetupCard>
    </Stack>
  );
}
