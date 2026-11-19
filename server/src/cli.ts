import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { createApp } from "./app.js";

// Entry for the published `snowstart` package: one local process that serves the app and its relay.

const MIN_NODE_MAJOR = 20;
const major = Number(process.versions.node.split(".")[0]);
if (major < MIN_NODE_MAJOR) {
  console.error(`snowstart needs Node ${MIN_NODE_MAJOR} or newer (this is ${process.version}). Install the current LTS from https://nodejs.org and try again.`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`snowstart — PagerDuty ↔ ServiceNow setup and linking app

Usage: npx snowstart [options]

  -p, --port <n>   port to listen on (default 4000; the next free one is used if it's taken)
      --no-open    don't open the browser
      --allow-host <domain>
                   also talk to ServiceNow instances on this domain (repeatable; *.service-now.com is always allowed)
  -h, --help       show this help

It runs entirely on this machine and listens on localhost only. Credentials you enter stay in the browser tab and are sent
only to your ServiceNow instance and to api.pagerduty.com.`);
  process.exit(0);
}
const portFlag = args.findIndex((a) => a === "-p" || a === "--port");
const wantedPort = portFlag >= 0 ? Number(args[portFlag + 1]) : Number(process.env.PORT) || 4000;
if (!Number.isInteger(wantedPort) || wantedPort < 1 || wantedPort > 65535) {
  console.error("--port must be a number between 1 and 65535");
  process.exit(1);
}
const shouldOpen = !args.includes("--no-open");
const extraHosts = args.flatMap((a, i) => (a === "--allow-host" && args[i + 1] ? [args[i + 1]] : []));
if (extraHosts.length > 0) {
  process.env.SNOWSTART_ALLOW_HOSTS = [process.env.SNOWSTART_ALLOW_HOSTS, ...extraHosts].filter(Boolean).join(",");
}

// esbuild bundles this file to CommonJS next to the built client in ../public.
const staticDir = process.env.SNOWSTART_STATIC_DIR ?? path.join(__dirname, "..", "public");

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

function openBrowser(url: string) {
  const [cmd, cmdArgs] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, cmdArgs, { stdio: "ignore", detached: true });
    child.on("error", () => undefined); // no browser launcher available — the URL is printed anyway
    child.unref();
  } catch {
    /* printed URL is enough */
  }
}

async function main() {
  let port = wantedPort;
  for (let i = 0; i < 20 && !(await isFree(port)); i++) port++;
  if (!(await isFree(port))) {
    console.error(`No free port found starting at ${wantedPort}. Pass one with --port.`);
    process.exit(1);
  }
  const app = createApp({ staticDir, localHostOnly: true });
  app.listen(port, "127.0.0.1", () => {
    const url = `http://localhost:${port}`;
    console.log(`\n  SnowStart is running at ${url}\n  Press Ctrl+C to stop.\n`);
    if (shouldOpen) openBrowser(url);
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
