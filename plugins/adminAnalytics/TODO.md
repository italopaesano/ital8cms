# adminAnalytics — TODO

## Feature: Analytics Settings Management

The `adminAnalytics` plugin should gain a second admin section (`analyticsSettings`)
that allows administrators to modify the `analytics` plugin's `pluginConfig.json5`
through a GUI form — without having to edit the raw JSON5 file directly.

This mirrors the pattern used in `adminSeo` / `seoManagement/globalSettings.ejs`.

### Planned form fields

| Field | Type | Notes |
|-------|------|-------|
| `gdprCompliance` | Toggle | |
| `sessionSalt` | Text | Show security warning; mask value by default |
| `useAnalyticsCookie` | Toggle | Show GDPR / cookie-banner warning when enabled |
| `analyticsCookieName` | Text | Show only when `useAnalyticsCookie: true` |
| `rotationMode` | Select | none / daily / weekly / monthly |
| `retentionDays` | Number | 0 = disabled |
| `dataPath` | Text | |
| `flushIntervalSeconds` | Number | |

### Implementation notes

- Read current values via `analyticsApi.getConfig()` (already exposed by analytics' shared object)
- Save via atomic filesystem write (temp file + rename, same pattern as adminAccessControl)
- Show a restart-required banner: changes to `rotationMode`, `retentionDays`, `dataPath`,
  and `flushIntervalSeconds` take effect only after server restart (plugin reads config at
  `loadPlugin()` time)
- Changes to `gdprCompliance`, `sessionSalt`, `useAnalyticsCookie` also require restart for
  new events; already-stored events are not retroactively modified
- Register `analyticsSettings` in both:
  - `plugins/adminAnalytics/pluginConfig.json5` → `adminSections` array
  - `core/admin/adminConfig.json5` → `sections` object + `menuOrder` array
- Update `.gitignore` to include the new symlink path:
  `/core/admin/webPages/analyticsSettings`
