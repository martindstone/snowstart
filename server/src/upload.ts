import type { Request, Response } from "express";
import { RelayError, validateInstanceUrl } from "./relay.js";

/**
 * ServiceNow has no REST endpoint for loading an update set from XML. The only
 * way in is the same servlet the "Import Update Set from XML" UI action uses
 * (/sys_upload.do), which needs a form-login session cookie plus the CSRF
 * token from the upload page — basic auth alone is accepted and silently
 * ignored. This reproduces that browser flow server-side.
 */

class CookieJar {
  private cookies = new Map<string, string>();

  absorb(res: globalThis.Response) {
    for (const cookie of res.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

const UA = "Mozilla/5.0 (snowstart relay)";

async function requestWithJar(jar: CookieJar, url: string, init: RequestInit = {}): Promise<globalThis.Response> {
  let current = url;
  let method = init.method ?? "GET";
  let body = init.body;
  for (let hop = 0; hop < 10; hop++) {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", UA);
    const cookie = jar.header();
    if (cookie) headers.set("Cookie", cookie);
    const res = await fetch(current, { ...init, method, body, headers, redirect: "manual" });
    jar.absorb(res);
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      // Browsers turn a redirected POST into a GET.
      method = "GET";
      body = undefined;
      continue;
    }
    return res;
  }
  throw new RelayError(502, "Too many redirects talking to ServiceNow");
}

function parseCredentials(req: Request): { base: string; username: string; password: string } {
  const base = validateInstanceUrl(req.header("x-sn-instance"));
  const encoded = req.header("x-sn-auth");
  if (!encoded) throw new RelayError(400, "x-sn-auth header is required");
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 1) throw new RelayError(400, "x-sn-auth must be base64(username:password)");
  return { base, username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

function readMetadata(xml: string) {
  const grab = (tag: string) => xml.match(new RegExp(`<sys_remote_update_set[\\s\\S]*?<${tag}>([^<]*)</${tag}>`))?.[1] ?? "";
  return { name: grab("name"), scope: grab("application_scope"), version: grab("application_version") };
}

async function remoteUpdateSetIds(base: string, basic: string, name: string): Promise<string[]> {
  const url = `${base}/api/now/table/sys_remote_update_set?${new URLSearchParams({
    sysparm_query: `name=${name}`,
    sysparm_fields: "sys_id",
  })}`;
  const res = await fetch(url, { headers: { Authorization: basic, Accept: "application/json", "User-Agent": UA } });
  if (!res.ok) throw new RelayError(502, `Could not list retrieved update sets (${res.status})`);
  const json = (await res.json()) as { result?: { sys_id: string }[] };
  return (json.result ?? []).map((r) => r.sys_id);
}

export async function handleUploadUpdateSet(req: Request, res: Response) {
  try {
    const { base, username, password } = parseCredentials(req);
    const file = req.body as Buffer;
    if (!Buffer.isBuffer(file) || file.length === 0) throw new RelayError(400, "Request body must be the update set XML");

    const head = file.subarray(0, 64 * 1024).toString("utf8");
    if (!head.includes("<sys_remote_update_set")) {
      throw new RelayError(400, "That file is not a ServiceNow update set export (no <sys_remote_update_set> found)");
    }
    const meta = readMetadata(head);
    const rawName = req.header("x-filename") ?? "update-set.xml";
    let decodedName = rawName;
    try {
      decodedName = decodeURIComponent(rawName);
    } catch {
      // keep the raw header value
    }
    const filename = decodedName.replace(/[^\w.\- ]/g, "_");
    const basic = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

    const before = new Set(await remoteUpdateSetIds(base, basic, meta.name));

    const jar = new CookieJar();
    await requestWithJar(jar, `${base}/login.do`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ user_name: username, user_password: password, sys_action: "sysverb_login" }).toString(),
    });

    const uploadPage = await requestWithJar(
      jar,
      `${base}/upload.do?${new URLSearchParams({ sysparm_target: "sys_remote_update_set", sysparm_referring_url: "sys_remote_update_set_list.do" })}`,
    );
    const html = await uploadPage.text();
    const ck = html.match(/name="sysparm_ck"[^>]*value="([0-9a-f]+)"/)?.[1];
    if (!ck) {
      throw new RelayError(
        401,
        "ServiceNow didn't accept a form login for this account (needed for update set upload). Check the password, or whether the account requires MFA/SSO.",
      );
    }

    const form = new FormData();
    form.set("sysparm_ck", ck);
    form.set("sysparm_upload_prefix", "");
    form.set("sysparm_referring_url", "sys_remote_update_set_list.do");
    form.set("sysparm_target", "sys_remote_update_set");
    form.set("attachFile", new Blob([new Uint8Array(file)], { type: "text/xml" }), filename);
    const uploaded = await requestWithJar(jar, `${base}/sys_upload.do`, { method: "POST", body: form });
    await uploaded.arrayBuffer();

    const created = (await remoteUpdateSetIds(base, basic, meta.name)).filter((id) => !before.has(id));
    if (created.length === 0) {
      throw new RelayError(502, "Upload finished but no new retrieved update set appeared in ServiceNow");
    }
    res.json({ remoteUpdateSetId: created[0], ...meta });
  } catch (err) {
    if (err instanceof RelayError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error("upload error:", err instanceof Error ? err.message : err);
    res.status(502).json({ error: "Update set upload to ServiceNow failed" });
  }
}
