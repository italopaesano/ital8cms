<!-- ital8doc v1-1 · tipo: guide · lang: en · stub -->
> 🌐 This document is maintained in Italian → see `cli-control-plane.it.md`. The English edition will be filled in at release.
# CLI control plane (`ital8cms-cli`) — ital8cms

> English translation pending. Authoritative version: [`cli-control-plane.it.md`](./cli-control-plane.it.md).

Terminal tool to drive a **running** ital8cms instance over a local UNIX socket
(SSH-friendly, no network port): `npm run cli -- status`,
`npm run cli -- admin start|stop` (enable/disable the admin area, triggers a
restart), `npm run cli -- public start|stop` (public maintenance gate, no
restart), `npm run cli -- reset <target>`. With `npm run`, positional arguments
are forwarded as-is, but **flags** (`--json`, `--theme`, …) are swallowed by npm
**silently** unless you insert `--` — always use it. Note that `public stop` also
returns 503 for `/api/*` and `/pluginPages/*` (the gate sits before the router);
the login page and login endpoint stay reachable through
`maintenance.exemptPaths`, which defaults to exempting them — set it to `[]` for
maximum lockdown. Config lives in `ital8Config.json5` (`cli` and `maintenance`
sections).
