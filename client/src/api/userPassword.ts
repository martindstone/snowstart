import { createRecord, getTablePage, snRequestOrThrow, SNApiError } from "./servicenow";
import { SN_PROPERTIES } from "../config/schema";
import type { SNCredentials } from "../types/servicenow";

/**
 * Newer ServiceNow releases store a `user_password` written through the Table API
 * as unhashed plaintext, so the account can never log in (every Basic-auth call
 * gets a 401). The password only hashes when it's set server-side with
 * setDisplayValue, so this runs a one-shot scheduled script that does exactly that.
 *
 * The password never goes into the script: it's read from the (encrypted)
 * x_pd_integration.sn_auth_userpwd property, which the caller must have written
 * first. That keeps the secret out of the sysauto_script row and its delete audit.
 */
const POLL_MS = 5000;
const TIMEOUT_MS = 4 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const utc = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

function hashScript(userSysId: string): string {
  return [
    "(function () {",
    `  var pw = gs.getProperty('${SN_PROPERTIES.snAuthUserPwd}');`,
    "  var user = new GlideRecord('sys_user');",
    `  if (pw && user.get('${userSysId}')) {`,
    "    user.user_password.setDisplayValue(pw);",
    "    user.update();",
    "  }",
    "})();",
  ].join("\n");
}

async function readStoredPassword(creds: SNCredentials, userSysId: string): Promise<string> {
  const rows = await getTablePage<{ user_password: string }>(creds, "sys_user", {
    sysparm_query: `sys_id=${userSysId}`,
    sysparm_fields: "user_password",
    sysparm_limit: 1,
  });
  return rows[0]?.user_password ?? "";
}

/**
 * Hashes the integration user's password from the sn_auth_userpwd property.
 * Resolves once ServiceNow has stored a new hashed password ("$s$…") for the user.
 */
export async function applyIntegrationPassword(
  creds: SNCredentials,
  adminSysId: string,
  userSysId: string,
): Promise<void> {
  // A reset account already has a hash, so wait for it to change rather than merely exist.
  const before = await readStoredPassword(creds, userSysId);
  const job = await createRecord<{ sys_id: string }>(creds, "sysauto_script", {
    name: `SnowStart set password ${userSysId.slice(0, 8)}`,
    active: true,
    sys_scope: "global",
    run_type: "once",
    run_as: adminSysId,
    conditional: false,
    // Slightly in the past so the scheduler picks it up on its next poll.
    run_start: utc(new Date(Date.now() - 5000)),
    script: hashScript(userSysId),
  });
  try {
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const now = await readStoredPassword(creds, userSysId);
      if (now.startsWith("$") && now !== before) return;
    }
    throw new SNApiError(
      504,
      "ServiceNow didn't apply the password within 4 minutes. Is the instance's scheduler running? Reset the password to try again.",
    );
  } finally {
    await snRequestOrThrow(creds, `/api/now/table/sysauto_script/${job.sys_id}`, { method: "DELETE" }).catch(() => undefined);
  }
}
