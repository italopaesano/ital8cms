# adminBootstrapNavbar

Admin plugin for creating and managing bootstrapNavbar navigation menus through a GUI editor in the admin panel.

## Overview

**adminBootstrapNavbar** provides a complete admin interface for managing navbar JSON5 configuration files used by the `bootstrapNavbar` plugin. It allows administrators to create, edit, validate, preview, duplicate, and delete navbar configurations without manual file editing.

**Key Features:**
- GUI editor with JSON5 syntax in the admin panel
- Live preview with Bootstrap rendering (shows all items including auth-filtered ones)
- JSON5 validation with internal link checking and role verification
- Toolbar with quick-insert snippets (items, dropdowns, separators, dividers)
- File picker to create items from existing EJS/HTML files
- Template system with 5 predefined navbar configurations
- Navbar creation from scratch, from template, or by duplication
- Soft-delete with backup (files moved to `backups/` directory)
- Automatic backup on save with configurable retention
- Recursive filesystem scanning for `navbar.*.json5` files in `/www/`
- Path traversal protection on all file operations

## Dependencies

| Dependency | Version | Purpose |
|-----------|---------|---------|
| `bootstrap` | ^1.0.0 | Bootstrap CSS/JS for admin UI and preview |
| `bootstrapNavbar` | ^1.0.0 | Navbar renderer used for live preview |
| `simpleI18n` | ^1.0.0 | i18n support for admin UI labels |

## Plugin Structure

```
plugins/adminBootstrapNavbar/
├── main.js                    # Plugin entry point, routes, preview renderer
├── pluginConfig.json5         # Plugin configuration
├── pluginDescription.json5    # Plugin metadata
├── backups/                   # Backup storage (soft-deletes + save backups)
│   └── .gitkeep
├── lib/
│   ├── navbarFileManager.js   # Filesystem operations (scan, read, write, backup, delete)
│   ├── navbarTemplates.js     # Predefined navbar templates (5 templates)
│   └── navbarValidator.js     # JSON5 validation engine
└── adminWebSections/
    └── navbarsManagement/     # Admin UI pages
        ├── index.ejs          # Navbar list (table with actions)
        ├── create.ejs         # Create new navbar (3 modes)
        ├── edit.ejs           # JSON5 editor with toolbar and preview
        ├── editor.css         # Editor styles
        └── editor.js          # Client-side editor logic
```

## Configuration

### pluginConfig.json5

```json5
{
  "active": 1,
  "isInstalled": 1,
  "weight": 50,
  "adminSections": ["navbarsManagement"],
  "dependency": {
    "bootstrap": "^1.0.0",
    "bootstrapNavbar": "^1.0.0",
    "simpleI18n": "^1.0.0"
  },
  "custom": {
    "maxBackupsPerFile": 10,
    "linkValidationSeverity": "warning",
    "allowedFileNameChars": "a-zA-Z0-9_-",
    "filePickerDefaultExt": ".ejs"
  }
}
```

**Custom Settings:**

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `maxBackupsPerFile` | number | `10` | Maximum backup files kept per navbar file |
| `linkValidationSeverity` | string | `"warning"` | `"warning"` or `"error"` for internal link checks |
| `allowedFileNameChars` | string | `"a-zA-Z0-9_-"` | Regex character class for valid navbar names |
| `filePickerDefaultExt` | string | `".ejs"` | Default filter in the file picker (`".ejs"`, `".html"`, `"*"`) |

## API Endpoints

All routes require authentication with roles: root (0), admin (1), or editor (2).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/adminBootstrapNavbar/list` | List all discovered navbar files |
| `GET` | `/api/adminBootstrapNavbar/load?file={name}` | Load content of a specific navbar file |
| `POST` | `/api/adminBootstrapNavbar/save` | Save navbar content (with backup) |
| `POST` | `/api/adminBootstrapNavbar/validate` | Validate JSON5 content without saving |
| `POST` | `/api/adminBootstrapNavbar/preview` | Render navbar preview HTML |
| `POST` | `/api/adminBootstrapNavbar/create` | Create a new navbar file |
| `POST` | `/api/adminBootstrapNavbar/duplicate` | Duplicate an existing navbar |
| `POST` | `/api/adminBootstrapNavbar/delete` | Soft-delete a navbar file |
| `GET` | `/api/adminBootstrapNavbar/templates` | List available templates |
| `GET` | `/api/adminBootstrapNavbar/browse-files` | Browse files for the file picker |
| `POST` | `/api/adminBootstrapNavbar/refresh-scan` | Re-scan filesystem for navbar files |

### Endpoint Details

#### POST /create

Creates a new navbar file in `/www/`.

**Body:**

```json
{
  "name": "myNavbar",
  "mode": "empty|template|duplicate",
  "templateId": "horizontalBase",
  "sourceFile": "navbar.main.json5"
}
```

- `mode: "empty"` — Creates minimal empty navbar
- `mode: "template"` — Uses a predefined template (requires `templateId`)
- `mode: "duplicate"` — Copies content from existing file (requires `sourceFile`)

#### POST /save

Saves content to an existing navbar file. Automatically creates a backup of the previous version.

**Body:**

```json
{
  "file": "navbar.main.json5",
  "content": "// JSON5 content..."
}
```

#### POST /validate

Validates JSON5 content without saving. Returns errors and warnings.

**Body:**

```json
{
  "content": "// JSON5 content..."
}
```

**Response:**

```json
{
  "valid": true,
  "errors": [],
  "warnings": ["sections.left[2].href: internal link \"/missing.ejs\" - target file not found"]
}
```

#### POST /preview

Renders a live Bootstrap navbar preview. Shows ALL items including those filtered by auth/roles, with visual indicators.

**Body:**

```json
{
  "content": "// JSON5 content..."
}
```

**Response:**

```json
{
  "success": true,
  "html": "<nav class=\"navbar...\">...</nav>",
  "settings": {
    "type": "horizontal",
    "colorScheme": "dark",
    "bgClass": "bg-primary",
    "expandAt": "lg",
    "itemsLeft": 3,
    "itemsRight": 2
  },
  "bootstrap": {
    "css": "/api/bootstrap/css/bootstrap.min.css",
    "js": "/api/bootstrap/js/bootstrap.bundle.min.js"
  }
}
```

## Library Modules

### navbarFileManager.js

Handles all filesystem operations for navbar configuration files.

**Exported Functions:**

| Function | Description |
|----------|-------------|
| `scanNavbarFiles(scanDir)` | Recursively scans directory for `navbar.*.json5` files |
| `readNavbarFile(filePath)` | Reads a navbar config file (returns content + parsed) |
| `saveNavbarFile(filePath, content, backupDir, wwwDir, maxBackups)` | Saves with automatic backup |
| `createNavbarFile(filePath, content)` | Creates a new navbar file |
| `deleteNavbarFile(filePath, backupDir, wwwDir)` | Soft-deletes (moves to backups) |
| `createBackup(filePath, backupDir, wwwDir, maxBackups)` | Creates a backup with timestamp |

**Scan Behavior:**
- Skips hidden directories (`.name`) and `node_modules`
- Follows symlinks to read directory contents
- Reads `settings.type` from each file for display metadata
- Returns `type: "unknown"` for unparseable files

**Backup Naming Convention:**
- Regular backups: `{relPath__}navbar.{name}___{ISO-timestamp}.json5`
- Soft-delete backups: `{relPath__}navbar.{name}___DELETED___{ISO-timestamp}.json5`

### navbarValidator.js

Validates navbar JSON5 configuration with comprehensive checks.

**Exported:**
- `validate(content, options)` — Main validation function
- `VALID_TYPES` — `['horizontal', 'vertical', 'offcanvas']`
- `VALID_EXPAND_AT` — `['sm', 'md', 'lg', 'xl', 'xxl']`
- `VALID_COLOR_SCHEMES` — `['dark', 'light']`
- `VALID_POSITIONS` — `['start', 'end']`
- `VALID_SHOW_WHEN` — `['authenticated', 'unauthenticated']`

**Validation checks:**

1. **JSON5 syntax** — Parse errors
2. **Required structure** — `settings` and `sections` objects
3. **Settings validation:**
   - `type` (error if invalid)
   - `id` (error if missing or empty)
   - `colorScheme`, `expandAt`, `position` (warnings if unexpected)
   - `autoActive`, `offcanvasAlways` (warnings if non-boolean)
4. **Item validation:**
   - Regular items: `label` required (string)
   - Dropdowns: `label` and `items` array required, sub-items validated recursively
   - Separators/dividers: no required fields
5. **Visibility validation:**
   - `showWhen`: must be `"authenticated"` or `"unauthenticated"`
   - `requiresAuth`: must be boolean
   - `allowedRoles`: must be array of numbers; role IDs validated against `roleData` if provided
6. **Internal link validation:**
   - Only `/`-prefixed links (skips external, API, admin, pluginPages)
   - Checks file existence in `wwwDir`
   - Tries `.ejs` extension and `index.ejs` fallbacks
   - Severity configurable: `"warning"` (default) or `"error"`

### navbarTemplates.js

Provides predefined navbar templates for quick creation.

**Exported Functions:**

| Function | Description |
|----------|-------------|
| `getTemplateList()` | Returns array of `{ id, label, description }` for UI display |
| `generateFromTemplate(templateId, navbarName)` | Generates JSON5 string from template |
| `generateEmpty(navbarName)` | Generates minimal empty navbar config |

**Available Templates:**

| ID | Type | Description |
|----|------|-------------|
| `horizontalBase` | horizontal | Minimal horizontal navbar |
| `horizontalComplete` | horizontal | Full navbar with dropdown, separator, auth items |
| `sidebar` | vertical | Sidebar with dropdown and auth |
| `offcanvasResponsive` | offcanvas | Responsive offcanvas (collapses at breakpoint) |
| `offcanvasAlways` | offcanvas | Always-visible hamburger, slides from right |

All templates:
- Start with JSON5 standard comment
- Use `navbarName` as `settings.id`
- Have both `left` and `right` section arrays
- Include i18n labels (Italian and English)

## Admin UI Pages

### Navbar List (`index.ejs`)

Main page showing all discovered navbar files in a table.

**Features:**
- Table with name, type badge, relative path, action buttons
- Type badges: blue (horizontal), green (vertical), cyan (offcanvas)
- Actions: Edit, Duplicate, Delete
- Refresh Scan button (re-scans filesystem)
- New Navbar button (links to create page)

### Create Navbar (`create.ejs`)

Page for creating new navbar files with three modes.

**Modes:**
1. **From scratch** — Empty navbar with default settings
2. **From template** — Select from 5 predefined templates
3. **From duplication** — Copy an existing navbar

**URL parameters (pre-fill):**
- `?mode=duplicate&source=navbar.main.json5&name=myNavbar`

### Edit Navbar (`edit.ejs`)

Full-featured JSON5 editor with toolbar, preview, and validation.

**Toolbar Features:**
- Quick-insert buttons: Item, Dropdown, Separator, Divider
- "From File" button (opens file picker modal)
- Section selector (left/right) for snippet insertion
- "Empty Template" button (replaces content)
- Icon helper with live preview

**Actions:**
- Validate — Checks JSON5 without saving
- Preview — Renders live Bootstrap navbar
- Save — Validates then saves (with backup)

**Auto-preview triggers:**
- After page load
- After snippet insertion
- After template replacement
- After successful save

**Preview indicators:**
- Lock badge (🔒) — Requires authentication/role
- Eye badge (👁) — Visible only to non-authenticated users

**File Picker Modal:**
- Tree view of `/www/` directory
- Developer mode: also shows `/pluginPages/` and `/admin/`
- Extension filter (`.ejs`, `.html`, all)
- Auto-generates label from filename (camelCase → "Camel Case")
- Inserts `{ "label": "...", "href": "..." }` snippet

## Security

- **Path traversal protection:** All file operations validate that resolved paths stay within `wwwDir`
- **Authentication required:** All API endpoints require auth with roles 0, 1, or 2
- **XSS prevention:** HTML escaping on labels and hrefs in preview rendering
- **Atomic writes:** Save operations use temp file + rename pattern
- **Soft delete:** Files are never permanently deleted; moved to backups directory

## Testing

**Location:** `/tests/unit/adminBootstrapNavbar/`

| File | Tests | Coverage |
|------|-------|----------|
| `navbarValidator.test.js` | 63 | JSON5 parsing, structure, settings, items, visibility, links |
| `navbarFileManager.test.js` | 33 | Scan, read, create, save, delete, backup operations |
| `navbarTemplates.test.js` | 35 | Template list, generation, empty config, cross-template consistency |
| **Total** | **131** | |

**Run tests:**

```bash
npx jest tests/unit/adminBootstrapNavbar/ --verbose
```
