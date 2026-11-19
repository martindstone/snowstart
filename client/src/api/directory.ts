import { getAllTableRows } from "./servicenow";
import { getAllUsers } from "./pagerduty";
import type { SNCredentials, SNUser } from "../types/servicenow";
import type { PDCredentials, PDUser } from "../types/pagerduty";
import type { UserMatch } from "../types/wizard";

export interface Directory {
  snUsers: SNUser[];
  pdUsers: PDUser[];
  matches: UserMatch[];
}

/** Pulls active users from both systems and matches them by email. */
export async function pullDirectory(sn: SNCredentials, pd: PDCredentials): Promise<Directory> {
  const [snUsers, pdUsers] = await Promise.all([
    getAllTableRows<SNUser>(sn, "sys_user", "active=true^emailISNOTEMPTY", [
      "sys_id",
      "user_name",
      "first_name",
      "last_name",
      "name",
      "email",
      "active",
      "x_pd_integration_pagerduty_id",
    ]),
    getAllUsers(pd),
  ]);

  const pdByEmail = new Map(pdUsers.map((u) => [u.email.toLowerCase(), u]));
  const snByEmail = new Map(snUsers.map((u) => [u.email.toLowerCase(), u]));
  const allEmails = new Set([...pdByEmail.keys(), ...snByEmail.keys()]);

  const matches: UserMatch[] = Array.from(allEmails).map((email) => {
    const snUser = snByEmail.get(email);
    const pdUser = pdByEmail.get(email);
    return { email, snUser, pdUser, status: snUser && pdUser ? "matched" : snUser ? "sn-only" : "pd-only" };
  });
  matches.sort((a, b) => a.email.localeCompare(b.email));
  return { snUsers, pdUsers, matches };
}
