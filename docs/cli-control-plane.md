<!-- ital8doc v1-1 · tipo: guide · lang: en · stub -->
> 🌐 This document is maintained in Italian → see `cli-control-plane.it.md`. The English edition will be filled in at release.
# CLI control plane (`ital8cms-cli`) — ital8cms

> English translation pending. Authoritative version: [`cli-control-plane.it.md`](./cli-control-plane.it.md).

Terminal tool to drive a **running** ital8cms instance over a local UNIX socket
(SSH-friendly, no network port): `npm run cli -- status`,
`npm run cli -- admin start|stop` (enable/disable the admin area, triggers a
restart), `npm run cli -- public start|stop` (public maintenance gate, no
restart), `npm run cli -- reserved start|stop` (the whole authenticated surface,
no restart), `npm run cli -- publicOnly on|off` (showcase preset, restarts),
`npm run cli -- reset <target>`, `npm run cli -- migrate <target>`. With
`npm run`, positional arguments are forwarded as-is, but **flags** (`--json`,
`--theme`, …) are swallowed by npm **silently** unless you insert `--` — always
use it.

The three areas are **nested**, not parallel: `admin` sits inside `reserved`.
`admin stop` disables the panel only; `reserved stop` makes everything behind
authentication — login page, auth endpoints, authenticated routes, the panel and
its theme assets — answer **404**, indistinguishable from a path that never
existed (matching the shape the site itself returns, which differs under
`apiPrefix`). The perimeter is *derived* from declarations that already exist
(`access.requiresAuth` on every route, `accessControl.json5` rules), plus the
`access.isAuthEntryPoint` marker for routes that must stay public to allow
logging in.

Note that `public stop` also returns 503 for `/api/*` and `/pluginPages/*` (the
gate sits before the router); the login page and login endpoint stay reachable
through `maintenance.exemptPaths`, which defaults to exempting them — set it to
`[]` for maximum lockdown. Those exemptions are **suspended while the reserved
surface is closed**, so `public stop` + `reserved stop` answers 503 everywhere
(an exempt 404 next to a 503 would map the reserved area). With the reserved
surface closed the only way back in is the terminal (`reserved start`). Config
lives in `ital8Config.json5` (`cli` and `maintenance` sections).
