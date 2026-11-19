import type { UserMatch } from "../types/app";

/**
 * What a PagerDuty user's row needs when linking to ServiceNow:
 *  - create:   no ServiceNow user with that email — create one carrying the PagerDuty id
 *  - link:     a ServiceNow user matches by email but doesn't hold the PagerDuty id yet — set it
 *  - linked:   the ServiceNow user already holds this PagerDuty user's id
 *  - conflict: the ServiceNow user holds a *different* PagerDuty id — never overwritten automatically
 */
export type UserLinkKind = "create" | "link" | "linked" | "conflict";

export function kindOf(m: UserMatch): UserLinkKind {
  if (!m.snUser) return "create";
  const stored = m.snUser.x_pd_integration_pagerduty_id ?? "";
  if (!stored) return "link";
  return stored === m.pdUser?.id ? "linked" : "conflict";
}

/** How many PagerDuty users match a ServiceNow user by email but aren't linked yet (the default user is the integration user's). */
export function countMatchedNotLinked(matches: UserMatch[], defaultPdUserId: string | null): number {
  return matches.filter((m) => m.pdUser && m.pdUser.id !== defaultPdUserId && kindOf(m) === "link").length;
}
