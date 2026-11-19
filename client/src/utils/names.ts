export function splitName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  const idx = trimmed.lastIndexOf(" ");
  if (idx === -1) return { firstName: trimmed, lastName: "" };
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1) };
}

export function usernameFromEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The PagerDuty app names everything it creates from ServiceNow "SN:<name>" (services from CIs/groups,
 * escalation policies from groups). Strips that prefix so such a PagerDuty entity can be matched back to the
 * ServiceNow record it came from. Names without the prefix come back unchanged.
 */
export function stripSnPrefix(name: string): string {
  return name.replace(/^\s*SN\s*:\s*/i, "");
}
