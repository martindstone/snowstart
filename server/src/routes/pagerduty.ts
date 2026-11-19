import { Router, type Response } from "express";
import { RelayError, buildUrl, forward, validateRelayBody } from "../relay.js";

const PD_BASE = "https://api.pagerduty.com";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { apiToken } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof apiToken !== "string" || !apiToken) {
      throw new RelayError(400, "apiToken is required");
    }
    const { method, path, params, data } = validateRelayBody(req.body);
    const url = buildUrl(PD_BASE, path, params);

    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Token token=${apiToken}`,
        Accept: "application/vnd.pagerduty+json;version=2",
        "Content-Type": "application/json",
      },
    };
    if (data !== undefined && method !== "GET") {
      init.body = JSON.stringify(data);
    }

    const result = await forward(url, init);
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
  console.error("pagerduty relay error:", err instanceof Error ? err.message : err);
  res.status(502).json({ error: "Upstream PagerDuty request failed" });
}

export default router;
