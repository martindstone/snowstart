import { useEffect, useState } from "react";
import { Alert, Button, Group, Modal, Select, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconAlertTriangle } from "@tabler/icons-react";
import { PDApiError, createService, getAllEscalationPolicies } from "../api/pagerduty";
import { currentPdCreds, useWizardStore } from "../store/wizardStore";
import type { PDService } from "../types/pagerduty";

interface CreatePdServiceModalProps {
  opened: boolean;
  onClose: () => void;
  onCreated: (service: PDService) => void;
}

export default function CreatePdServiceModal({ opened, onClose, onCreated }: CreatePdServiceModalProps) {
  const pdServices = useWizardStore((s) => s.pdServices);
  const setPdServices = useWizardStore((s) => s.setPdServices);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [policies, setPolicies] = useState<{ id: string; name: string }[]>([]);
  const [loadingPolicies, setLoadingPolicies] = useState(false);

  const form = useForm({
    initialValues: { name: "", description: "", escalationPolicyId: "" },
    validate: {
      name: (v) => (v ? null : "Required"),
      escalationPolicyId: (v) => (v ? null : "Required"),
    },
  });

  useEffect(() => {
    if (!opened) return;
    setLoadingPolicies(true);
    getAllEscalationPolicies(currentPdCreds())
      .then(setPolicies)
      .catch(() => setPolicies([]))
      .finally(() => setLoadingPolicies(false));
  }, [opened]);

  const handleSubmit = async () => {
    const result = form.validate();
    if (result.hasErrors) return;
    setSaving(true);
    setError(null);
    try {
      const service = await createService(currentPdCreds(), form.values);
      setPdServices([...pdServices, service]);
      onCreated(service);
      form.reset();
      onClose();
    } catch (e) {
      setError(e instanceof PDApiError ? e.message : e instanceof Error ? e.message : "Failed to create service");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Create PagerDuty service">
      <Stack>
        <TextInput label="Name" {...form.getInputProps("name")} />
        <Textarea label="Description" autosize minRows={2} {...form.getInputProps("description")} />
        <Select
          label="Escalation policy"
          placeholder={loadingPolicies ? "Loading…" : "Select an escalation policy"}
          data={policies.map((p) => ({ value: p.id, label: p.name }))}
          disabled={loadingPolicies}
          searchable
          {...form.getInputProps("escalationPolicyId")}
        />
        {!loadingPolicies && policies.length === 0 && (
          <Text size="sm" c="dimmed">
            No escalation policies found — create one in PagerDuty first.
          </Text>
        )}
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
