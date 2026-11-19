import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import pagerdutyRouter from "./routes/pagerduty.js";
import servicenowRouter from "./routes/servicenow.js";
import { handleUploadUpdateSet } from "./upload.js";

export interface AppOptions {
  /** Origins allowed to call the relay cross-origin (the Vite dev server). Same-origin calls never need this. */
  allowedOrigins?: string[];
  /** Directory of the built client to serve, with a single-page-app fallback to index.html. */
  staticDir?: string;
  /**
   * Reject requests whose Host header isn't localhost. Protects the locally running relay from DNS-rebinding, where a
   * web page the user visits resolves its own name to 127.0.0.1 and talks to the relay as if it were same-origin.
   */
  localHostOnly?: boolean;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostGuard(req: Request, res: Response, next: NextFunction) {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!LOCAL_HOSTS.has(host)) {
    res.status(403).json({ error: "This relay only answers requests addressed to localhost." });
    return;
  }
  next();
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  if (options.localHostOnly) app.use(hostGuard);
  if (options.allowedOrigins?.length) app.use(cors({ origin: options.allowedOrigins }));
  app.use(express.json({ limit: "2mb" }));

  app.post("/api/servicenow/upload-update-set", express.raw({ type: "*/*", limit: "200mb" }), handleUploadUpdateSet);
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/servicenow", servicenowRouter);
  app.use("/api/pagerduty", pagerdutyRouter);

  if (options.staticDir) {
    const indexHtml = path.join(options.staticDir, "index.html");
    if (!fs.existsSync(indexHtml)) throw new Error(`No built client found at ${options.staticDir}`);
    app.use(express.static(options.staticDir));
    // Anything that isn't an API call or a real file is a client-side route.
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(indexHtml));
  }
  return app;
}
