// Builds the publishable package: the wizard UI into ./public and the relay (with Express and its other dependencies
// bundled in) into a single executable ./bin/snowstart.cjs, so `npx snowstart` installs nothing else.
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

execFileSync("npm", ["run", "build", "-w", "client"], { cwd: root, stdio: "inherit" });

rmSync(join(here, "public"), { recursive: true, force: true });
cpSync(join(root, "client", "dist"), join(here, "public"), { recursive: true });

mkdirSync(join(here, "bin"), { recursive: true });
const out = join(here, "bin", "snowstart.cjs");
await build({
  entryPoints: [join(root, "server", "src", "cli.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "info",
});
chmodSync(out, 0o755);
