import { useState } from "react";
import { Alert, Button, Group, Modal, Select, Stack, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconAlertTriangle } from "@tabler/icons-react";
import { PDApiError, createUser } from "../api/pagerduty";
import { currentPdCreds, useWizardStore } from "../store/wizardStore";
import type { PDUser } from "../types/pagerduty";

interface CreatePdUserModalProps {
  opened: boolean;
  onClose: () => void;
  onCreated: (user: PDUser) => void;
}

export default function CreatePdUserModal({ opened, onClose, onCreated }: CreatePdUserModalProps) {
  const addPdUser = useWizardStore((s) => s.addPdUser);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    initialValues: { name: "", email: "", role: "responder" },
    validate: {
      name: (v) => (v ? null : "Required"),
      email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : "Must be a valid email"),
    },
  });

  const handleSubmit = async () => {
    const result = form.validate();
    if (result.hasErrors) return;
    setSaving(true);
    setError(null);
    try {
      const user = await createUser(currentPdCreds(), form.values);
      addPdUser(user);
      onCreated(user);
      form.reset();
      onClose();
    } catch (e) {
      setError(e instanceof PDApiError ? e.message : e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Create PagerDuty user">
      <Stack>
        <TextInput label="Name" {...form.getInputProps("name")} />
        <TextInput label="Email" {...form.getInputProps("email")} />
        <Select
          label="Role"
          data={["admin", "manager", "responder", "observer", "restricted_access"]}
          {...form.getInputProps("role")}
        />
        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />}>
            {error}
          </Alert>
        )}
        <Group justify="end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={saving}>
            Create
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
