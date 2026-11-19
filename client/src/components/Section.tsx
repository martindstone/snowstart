import { Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

interface SectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/** A section heading with its description and content. */
export default function Section({ title, description, children }: SectionProps) {
  return (
    <Stack gap="md">
      <div>
        <Title order={3}>{title}</Title>
        {description && (
          <Text c="dimmed" size="sm" mt={4}>
            {description}
          </Text>
        )}
      </div>
      {children}
    </Stack>
  );
}
