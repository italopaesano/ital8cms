# urlRedirect Plugin

URL redirect plugin for site migrations. Manages 301 (permanent) and 302 (temporary) redirects based on a JSON5 configuration file.

## Features

- **Exact, wildcard, and regex** pattern matching
- **First-match-wins** evaluation order (array order in `redirectMap.json5`)
- **Hit counter** with periodic flush to disk (tracks usage per rule)
- **Query string preservation** (configurable)
- **Trailing slash normalization** (configurable)
- **Case-insensitive matching** (configurable)
- **External redirect blocking** (security, configurable)
- **Debug mode** re-reads config on every request; production mode caches
- **Graceful shutdown** flushes hit counters on SIGTERM/SIGINT
- **Shared objects** for future admin plugin integration

## Directory Structure

```
plugins/urlRedirect/
├── main.js                    # Entry point: loadPlugin + getMiddlewareToAdd
├── pluginConfig.json5         # Feature configuration (all toggleable)
├── pluginDescription.json5    # Plugin metadata
├── redirectMap.json5          # Redirect rules (the "database")
├── redirectHitCount.json5     # Hit counters (auto-generated)
└── lib/
    ├── redirectMatcher.js     # Matching engine (exact, wildcard, regex)
    ├── hitCounter.js          # Hit counter with periodic flush
    └── configValidator.js     # Boot-time validation
```

## Quick Start

1. Edit `redirectMap.json5` to add your redirect rules:

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "redirects": [
    { "from": "/old-page", "to": "/new-page" },
    { "from": "/blog/*", "to": "/articles/*" },
  ],
}
```

2. Restart the server. The plugin loads automatically.

## Redirect Rules

Rules are defined in `redirectMap.json5` as an array of objects. They are evaluated **in array order** (first-match-wins). To control priority, reorder the rules in the array.

### Rule Format

```json5
{
  "from": "/old-path",     // Source URL pattern (required)
  "to": "/new-path",       // Destination URL (required)
  "type": 301,             // HTTP status code (optional, default: 301)
}
```

`type` is optional. If omitted, defaults to `301` (permanent redirect). Supported values: `301`, `302`.

### Pattern Types

#### Exact Match

```json5
{ "from": "/about-us", "to": "/about" }
```

Matches only the exact path `/about-us`.

#### Single Wildcard (`*`)

Matches **one path segment** (no `/`).

```json5
{ "from": "/blog/*", "to": "/articles/*" }
// /blog/my-post → /articles/my-post
// /blog/2024/post → NO MATCH (multiple segments)
```

The captured segment replaces `*` in the `to` pattern.

#### Recursive Wildcard (`**`)

Matches **everything** including `/`.

```json5
{ "from": "/old-docs/**", "to": "/docs/**" }
// /old-docs/guide → /docs/guide
// /old-docs/guide/install/linux → /docs/guide/install/linux
```

The captured path replaces `**` in the `to` pattern.

#### Regex

Prefix with `regex:`. Supports capture groups via `$1`, `$2`, etc.

```json5
{ "from": "regex:^/product/(\\d+)\\.html$", "to": "/products/$1" }
// /product/42.html → /products/42
```

### External Redirects

Redirect to other domains:

```json5
{ "from": "/old-shop", "to": "https://shop.example.com", "type": 301 }
```

**Requires** `allowExternalRedirects: true` in `pluginConfig.json5` (disabled by default for security).

## Configuration

All features are toggled in `pluginConfig.json5` under the `custom` section:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enableHitCounter` | boolean | `true` | Track redirect usage counts |
| `hitCounterFlushInterval` | number | `30` | Seconds between disk writes (0 = immediate) |
| `preserveQueryString` | boolean | `true` | Append original query string to destination |
| `normalizeTrailingSlash` | boolean | `true` | `/page/` matches `/page` |
| `caseSensitive` | boolean | `true` | Case-sensitive URL matching |
| `enablePatternMatching` | boolean | `true` | Enable `*` and `**` wildcards |
| `enableRegex` | boolean | `true` | Enable `regex:` patterns |
| `allowExternalRedirects` | boolean | `false` | Allow redirects to other domains |
| `enableLogging` | boolean | `true` | Log each redirect to console |
| `strictValidation` | boolean | `false` | Crash on boot if validation errors (vs. warning + skip) |

## Behavior Details

### Only GET Requests

The middleware only intercepts `GET` requests. POST, PUT, DELETE, etc. pass through unchanged.

### Debug vs Production Mode

- **Debug mode** (`ital8Config.json5` → `debugMode >= 1`): re-reads `redirectMap.json5` on every request. Changes are immediate.
- **Production mode** (`debugMode: 0`): reads once at boot, caches in memory. Server restart required for changes.

### Evaluation Order (First-Match-Wins)

Rules are evaluated **in the order they appear** in the `redirects` array. The first matching rule is applied. To change priority, reorder the array.

This approach gives the user full control over precedence — no automatic priority calculation.

### Disabled Patterns

If a rule uses a wildcard but `enablePatternMatching: false`, the rule is **skipped with a warning** (not treated as a literal string).

Same behavior for regex rules when `enableRegex: false`.

### Hit Counter

When enabled, tracks:
- `hitCount` — number of times the redirect was triggered
- `firstHit` — timestamp of the first redirect
- `lastHit` — timestamp of the most recent redirect

Data is stored in `redirectHitCount.json5`:

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "/old-page": {
    "hitCount": 142,
    "firstHit": "2026-03-01T10:00:00.000Z",
    "lastHit": "2026-03-19T14:30:00.000Z",
  },
}
```

The key is the `from` value of the rule.

Counters are accumulated in memory and flushed to disk periodically (configurable via `hitCounterFlushInterval`). On SIGTERM/SIGINT, a final flush is performed.

### Redirect Chains

If `/a` → `/b` and `/b` → `/c`, the plugin does **single hop** only: it redirects to `/b`. The browser then makes a new request and gets redirected to `/c`. This is simpler and more predictable. Loop detection at boot warns about direct loops (A→B→A).

### Query String Preservation

When `preserveQueryString: true`:

```
GET /old-page?page=2&sort=name → 301 /new-page?page=2&sort=name
```

If the destination already has query parameters, the original ones are appended with `&`.

### Validation at Boot

At startup, the plugin validates all rules:

| Check | Severity | Behavior |
|-------|----------|----------|
| Missing `from` | ERROR | Rule skipped |
| Missing `to` | ERROR | Rule skipped |
| Invalid `type` | WARNING | Defaults to 301 |
| Duplicate `from` | WARNING | First wins, duplicate skipped |
| Invalid regex | ERROR | Rule skipped |
| Wildcard with `enablePatternMatching: false` | WARNING | Rule skipped |
| External URL with `allowExternalRedirects: false` | WARNING | Rule skipped |
| Direct redirect loop (A→B→A) | WARNING | Logged |

With `strictValidation: true`, all warnings become errors and the server crashes on boot.

## Console Logging

### Boot

```
[urlRedirect] Loaded 15 redirect rules (12 exact, 2 wildcard, 1 regex)
[urlRedirect] Hit counter enabled (flush every 30s)
```

### Runtime (with `enableLogging: true`)

```
[urlRedirect] 301 /old-page → /new-page
[urlRedirect] 301 /blog/my-post → /articles/my-post (wildcard)
[urlRedirect] 302 /promo → /offers
[urlRedirect] BLOCKED external redirect: /shop → https://evil.com (allowExternalRedirects: false)
```

## Shared Objects

The plugin exposes data to other plugins via `getObjectToShareToOthersPlugin()`:

```javascript
const urlRedirectApi = pluginSys.getSharedObject('urlRedirect');

urlRedirectApi.getRedirectRules();  // Array of all loaded rules
urlRedirectApi.getHitCounts();      // Hit count data (object)
urlRedirectApi.getRuleCount();      // Number of loaded rules
```

Useful for a future admin plugin that manages redirects visually.

## Tests

```bash
npx jest tests/unit/urlRedirect/ --verbose
```

3 test files, 101 tests:

| File | Tests | Covers |
|------|-------|--------|
| `configValidator.test.js` | Validation logic, utilities |
| `redirectMatcher.test.js` | Exact, wildcard, regex matching, query string |
| `hitCounter.test.js` | Counters, flush, shutdown, persistence |

## File Reference

| File | Purpose |
|------|---------|
| `main.js` | Plugin entry point, middleware, shared objects |
| `lib/redirectMatcher.js` | URL matching engine |
| `lib/hitCounter.js` | Hit counter with periodic flush |
| `lib/configValidator.js` | Boot-time rule validation |
| `pluginConfig.json5` | Feature toggle configuration |
| `pluginDescription.json5` | Plugin metadata |
| `redirectMap.json5` | Redirect rules (user-editable) |
| `redirectHitCount.json5` | Hit counters (auto-generated) |
