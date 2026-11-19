import { Button, Group, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";
import { useWizardStore } from "../store/wizardStore";

interface StepShellProps {
  title: string;
  description?: string;
  children: ReactNode;
  onNext?: () => void | Promise<void>;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextLoading?: boolean;
  hideBack?: boolean;
  hideNext?: boolean;
}

export default function StepShell({
  title,
  description,
  children,
  onNext,
  nextLabel = "Next",
  nextDisabled,
  nextLoading,
  hideBack,
  hideNext,
}: StepShellProps) {
  const back = useWizardStore((s) => s.back);
  const next = useWizardStore((s) => s.next);

  const handleNext = async () => {
    if (onNext) {
      await onNext();
    } else {
      next();
    }
  };

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>{title}</Title>
        {description && (
          <Text c="dimmed" mt={4}>
            {description}
          </Text>
        )}
      </div>
      {children}
      <Group justify="space-between" mt="md">
        {!hideBack ? (
          <Button variant="default" onClick={back}>
            Back
          </Button>
        ) : (
          <div />
        )}
        {!hideNext && (
          <Button onClick={handleNext} disabled={nextDisabled} loading={nextLoading}>
            {nextLabel}
          </Button>
        )}
      </Group>
    </Stack>
  );
}
