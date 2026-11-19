import { useEffect } from "react";
import { AppShell, Badge, Box, Container, Group, Stack, Text, Title, Tooltip } from "@mantine/core";
import { useWizardStore } from "./store/wizardStore";
import Step0Welcome from "./steps/Step0Welcome";
import Step1ConnectServiceNow from "./steps/Step1ConnectServiceNow";
import StepTableAccess from "./steps/StepTableAccess";
import StepInstallApp from "./steps/StepInstallApp";
import StepViews from "./steps/StepViews";
import StepPriorities from "./steps/StepPriorities";
import Step2ConnectPagerDuty from "./steps/Step2ConnectPagerDuty";
import Step4UpdateSet from "./steps/Step4UpdateSet";
import Step5BaseSettings from "./steps/Step5BaseSettings";
import Step6IntegrationUser from "./steps/Step6IntegrationUser";
import Step7LinkUsers from "./steps/Step7LinkUsers";
import Step8LinkServices from "./steps/Step8LinkServices";
import Step9LinkEscalationPolicies from "./steps/Step9LinkEscalationPolicies";
import Step10Summary from "./steps/Step10Summary";

const STEP_LABELS = [
  "Welcome",
  "ServiceNow",
  "Table Access",
  "Install App",
  "PagerDuty",
  "Update Set",
  "Base Settings",
  "Views",
  "Priorities",
  "Integration User",
  "Link Users",
  "Link Services",
  "Link Escalations",
  "Summary",
];

export default function App() {
  const step = useWizardStore((s) => s.step);
  const updateSet = useWizardStore((s) => s.updateSet);
  const loadDirectory = useWizardStore((s) => s.loadDirectory);
  const directoryStatus = useWizardStore((s) => s.directoryStatus);
  const bothConnected = useWizardStore((s) => !!s.snCreds && !!s.pdCreds);

  // Once both systems are connected, pull and match users in the background; later steps use the result.
  useEffect(() => {
    if (bothConnected && directoryStatus === "idle") void loadDirectory();
  }, [bothConnected, directoryStatus, loadDirectory]);

  const steps = [
    <Step0Welcome key="welcome" />,
    <Step1ConnectServiceNow key="sn" />,
    <StepTableAccess key="access" />,
    <StepInstallApp key="install" />,
    <Step2ConnectPagerDuty key="pd" />,
    <Step4UpdateSet key="updateset" />,
    <Step5BaseSettings key="base" />,
    <StepViews key="views" />,
    <StepPriorities key="priorities" />,
    <Step6IntegrationUser key="intuser" />,
    <Step7LinkUsers key="linkusers" />,
    <Step8LinkServices key="linkservices" />,
    <Step9LinkEscalationPolicies key="linkeps" />,
    <Step10Summary key="summary" />,
  ];

  return (
    <AppShell header={{ height: 64 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <Title order={3}>SnowStart</Title>
            <Text c="dimmed" size="sm">
              PagerDuty ↔ ServiceNow setup wizard
            </Text>
          </Group>
          {updateSet && (
            <Badge color="grape" size="lg">
              Update Set: {updateSet.name}
            </Badge>
          )}
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="lg" py="md">
          <Stack gap={6} mb="xl">
            <Group justify="space-between" align="baseline">
              <Text fw={600}>{STEP_LABELS[step]}</Text>
              <Text size="sm" c="dimmed">
                Step {step + 1} of {STEP_LABELS.length}
              </Text>
            </Group>
            <Group gap={4} wrap="nowrap">
              {STEP_LABELS.map((label, i) => (
                <Tooltip key={label} label={label} openDelay={150}>
                  <Box
                    h={6}
                    style={{
                      flex: 1,
                      borderRadius: 3,
                      background:
                        i < step
                          ? "var(--mantine-color-blue-6)"
                          : i === step
                            ? "var(--mantine-color-blue-3)"
                            : "var(--mantine-color-gray-3)",
                    }}
                  />
                </Tooltip>
              ))}
            </Group>
          </Stack>
          {steps[step]}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
