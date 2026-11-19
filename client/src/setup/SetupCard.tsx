import { useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Box, Collapse, Group, Loader, Paper, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import { IconCheck, IconChevronDown, IconChevronRight, IconCircleDashed, IconClock, IconAlertTriangle } from "@tabler/icons-react";
import { useAppStore } from "../store/appStore";
import type { ItemId, ItemStatus } from "../api/readiness";

const STATUS_STYLE: Record<ItemStatus, { color: string; label: string }> = {
  ok: { color: "green", label: "Done" },
  todo: { color: "blue", label: "To do" },
  warn: { color: "yellow", label: "Needs attention" },
  blocked: { color: "gray", label: "Waiting" },
};

function StatusIcon({ status }: { status: ItemStatus }) {
  const { color } = STATUS_STYLE[status];
  const icon =
    status === "ok" ? <IconCheck size={16} /> : status === "warn" ? <IconAlertTriangle size={16} /> : status === "blocked" ? <IconClock size={16} /> : <IconCircleDashed size={16} />;
  return (
    <ThemeIcon color={color} variant={status === "ok" ? "filled" : "light"} radius="xl" size={28}>
      {icon}
    </ThemeIcon>
  );
}

interface SetupCardProps {
  id: ItemId;
  title: string;
  description: string;
  children: ReactNode;
}

/**
 * One link in the setup chain. Its status comes from the live readiness check, so it reflects the instance rather than
 * what this session did. A finished card collapses to its summary (open it to reconfigure); one that's waiting on an
 * earlier card says so and doesn't load anything until that's done.
 */
export default function SetupCard({ id, title, description, children }: SetupCardProps) {
  const item = useAppStore((s) => s.readiness?.items.find((i) => i.id === id));
  const loading = useAppStore((s) => s.readinessStatus === "loading");
  const status = item?.status ?? "blocked";
  const blocked = status === "blocked";

  const [open, setOpen] = useState(status === "todo" || status === "warn");
  // When a card stops waiting and has work to do, open it. Don't close anything on the user's behalf.
  const previous = useRef(status);
  useEffect(() => {
    if (previous.current === "blocked" && (status === "todo" || status === "warn")) setOpen(true);
    previous.current = status;
  }, [status]);

  // The body is mounted the first time the card opens and then kept, so its work isn't lost by collapsing it.
  const [mounted, setMounted] = useState(open && !blocked);
  if (open && !blocked && !mounted) setMounted(true);

  const { color, label } = STATUS_STYLE[status];
  return (
    <Paper withBorder radius="md" p="md" style={blocked ? { opacity: 0.7 } : undefined}>
      <UnstyledButton w="100%" onClick={() => !blocked && setOpen((o) => !o)} disabled={blocked} aria-expanded={open}>
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Group wrap="nowrap" align="flex-start" gap="sm">
            <StatusIcon status={status} />
            <Box>
              <Text fw={600}>{title}</Text>
              <Text size="sm" c="dimmed">
                {blocked && item?.blockedBy ? `Waiting on: ${item.blockedBy}` : (item?.detail ?? description)}
              </Text>
            </Box>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {loading && <Loader size={14} />}
            <Badge color={color} variant="light">
              {label}
            </Badge>
            {!blocked && (open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />)}
          </Group>
        </Group>
      </UnstyledButton>
      <Collapse expanded={open && !blocked} keepMounted={mounted}>
        <Box pt="md">
          <Text size="sm" c="dimmed" mb="md">
            {description}
          </Text>
          {mounted && children}
        </Box>
      </Collapse>
    </Paper>
  );
}
