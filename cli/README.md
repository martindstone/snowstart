# snowstart

A setup wizard for the PagerDuty ServiceNow integration. It installs and configures the PagerDuty app on a ServiceNow instance, then links users, services and escalation policies. It makes real changes, so point it at a sandbox (PDI).  

**Don't use this on a production ServiceNow instance. I have no idea what would happen if you did that.**

## You'll need

- A ServiceNow **admin** account with the roles `snc_basic_auth_api_access` and `snc_platform_rest_api_access`
- The PagerDuty app's **update set XML** (not needed if the app is already installed)
- A PagerDuty **REST API token** (global, read/write)

## Run it

**1. Check that you have `npx`.** It comes with Node.js, and you need Node 20 or newer. Open **Terminal** (on a Mac,
press Cmd+Space, type "Terminal" and press Return), then type these two commands, pressing Return after each one:

```bash
npx -v
node -v    # should print v20 or higher
```

If both print a version, skip to step 3.

**2. If not, install Node.js.** Download the **LTS** version from <https://nodejs.org> and run the installer (on a Mac, `brew install node` also works). Then close Terminal, open a **new** Terminal window, and type the two commands from step 1 again.

**3. Run the wizard.** In Terminal, type this and press Return:

```bash
npx -y snowstart
```

Your browser opens to the wizard. Follow the instructions and have fun. Everything runs on your local system and listens on `localhost` only. Credentials stay in the browser tab and are sent only to your ServiceNow instance and to `api.pagerduty.com`.

## Options

```
npx -y snowstart [--port <n>] [--no-open] [--allow-host <domain>]
```

By default it only talks to `*.service-now.com`. For an instance on a custom domain, add `--allow-host your.domain.com`.

## License

MIT. See [LICENSE](LICENSE).
