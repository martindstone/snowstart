import { Divider, Stack } from "@mantine/core";
import ViewsSection from "./ViewsSection";
import PrioritiesSection from "./PrioritiesSection";

/** One-time configuration the app needs once it's installed: PagerDuty fields on the forms and lists, and priority mappings. */
export default function ConfigurationSection() {
  return (
    <Stack gap="xl" maw={820}>
      <ViewsSection />
      <Divider />
      <PrioritiesSection />
    </Stack>
  );
}
