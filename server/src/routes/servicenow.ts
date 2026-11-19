import { Router, type Response } from "express";
import { RelayError, buildUrl, forwardWithRetry, validateInstanceUrl, validateRelayBody } from "../relay.js";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { instanceUrl, username, password } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof username !== "string" || !username || typeof password !== "string") {
      throw new RelayError(400, "username and password are required");
    }
    const base = validateInstanceUrl(instanceUrl);
    const { method, path, params, data } = validateRelayBody(req.body);
    const url = buildUrl(base, path, params);

    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    };
    if (data !== undefined && method !== "GET") {
      init.body = JSON.stringify(data);
    }

    const result = await forwardWithRetry(url, init);
    res.status(200).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

function handleError(res: Response, err: unknown) {
  if (err instanceof RelayError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("servicenow relay error:", err instanceof Error ? err.message : err);
  res.status(502).json({ error: "Upstream ServiceNow request failed" });
}

export default router;
