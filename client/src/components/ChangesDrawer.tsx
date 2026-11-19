import { Anchor, Badge, Drawer, ScrollArea, Table, Text } from "@mantine/core";
import { useAppStore } from "../store/appStore";

/** Everything this session has changed in ServiceNow and PagerDuty, newest last. */
export default function ChangesDrawer({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const changeLog = useAppStore((s) => s.changeLog);
  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="xl" title="Changes this session">
      {changeLog.length === 0 ? (
        <Text c="dimmed">Nothing has been changed yet.</Text>
      ) : (
        <ScrollArea h="calc(100vh - 100px)">
          <Table stickyHeader striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Time</Table.Th>
                <Table.Th>System</Table.Th>
                <Table.Th>Description</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {changeLog.map((entry) => (
                <Table.Tr key={entry.id}>
                  <Table.Td>{new Date(entry.timestamp).toLocaleTimeString()}</Table.Td>
                  <Table.Td>
                    <Badge color={entry.system === "servicenow" ? "blue" : "grape"}>{entry.system}</Badge>
                  </Table.Td>
                  <Table.Td>
                    {entry.link ? (
                      <Anchor href={entry.link} target="_blank">
                        {entry.description}
                      </Anchor>
                    ) : (
                      entry.description
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Drawer>
  );
}
