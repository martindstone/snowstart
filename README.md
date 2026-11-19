# SnowStart

Set up and manage the PagerDuty ↔ ServiceNow integration. SnowStart installs the PagerDuty app on a ServiceNow instance,
configures it, and links your users, services and escalation policies. It's meant for sandbox instances (PDIs).

**Don't point it at a production ServiceNow instance.** It makes real changes to both systems.

## Just want to use it?

```bash
npx -y snowstart
```

You need Node.js 20 or newer. The npm package's [README](cli/README.md) has the full instructions, including what
credentials and files you'll need.

## What it does

After you connect to both ServiceNow and PagerDuty, SnowStart checks how far along the instance is and opens on the
right tab.

- **Setup** is a chain of cards, each detected from the instance: table access, the PagerDuty app (installed from an
  update set XML you provide), the defaults (default user and service), and the integration user with its async webhook
  processing. A set-up instance shows them all done; a fresh one walks through them in order.
- **Configuration** adds the PagerDuty fields to the Default view's lists and forms, and maps PagerDuty priorities to
  Impact and Urgency.
- **Link users / services / escalations** match PagerDuty entities to ServiceNow users, CIs and assignment groups. The
  app names the things it creates `SN:<name>`, so those are matched back automatically. Linking a CI also provisions
  its PagerDuty webhook.
- **Verify** is a checklist of deep links for confirming the integration end to end.
- The header has the **update set** that captures configuration changes, and a log of **changes** made this session.

## How it works

The browser app can't call ServiceNow or PagerDuty directly (neither allows cross-origin requests), so a small local
server relays the calls.

| Part | What it is |
| --- | --- |
| `client/` | React, Mantine and Vite single-page app. State lives in memory in a zustand store. |
| `server/` | Express relay for ServiceNow and PagerDuty, plus the update-set upload. Also serves the built client when run as the package. |
| `cli/` | The publishable `snowstart` npm package: the relay bundled into one file, with the built client alongside. |

A few things worth knowing:

- **Credentials never touch disk.** They stay in the browser tab and are relayed straight to your ServiceNow instance
  and `api.pagerduty.com`. The relay only talks to `*.service-now.com` (add others with `--allow-host`), listens on
  `localhost` only, and the packaged server rejects requests with a non-local `Host` header.
- **Everything is detected from the instance**, not remembered. The readiness check (`client/src/api/readiness.ts`)
  re-reads ServiceNow, so reloading, or someone else changing the instance, never leaves the UI out of step.
- **Some things need server-side code, and ServiceNow has no REST endpoint for that.** Hashing the integration user's
  password, clearing the cache, and provisioning webhooks with the app's own code run as one-shot scheduled scripts
  created through the Table API. SnowStart reads the result back from the system log and deletes the job.
- **Installing the app** reproduces what the "Load update set from XML" UI does: upload, preview and commit through
  ServiceNow's CI/CD API.

## Developing

You need Node.js 20.19 or newer (Vite 8).

```bash
npm install
npm run dev        # the Vite dev server on :5173 and the relay on :4000, both with hot reload
```

Open <http://localhost:5173>. The dev server proxies `/api` to the relay.

```bash
npm run build:package      # build the client and bundle the relay into cli/
cd client && npx tsc -b --noEmit && npm run lint
```

## Publishing

```bash
cd cli
npm version <patch|minor> --no-git-tag-version
npm publish --access public      # `prepack` rebuilds the package first
```

The package contains only the bundled relay, the built client and the README and license (check with `npm pack --dry-run`).

## License

MIT. See [LICENSE](LICENSE).
