# ital8cms

**Modular, plugin-based Content Management System** built on Node.js and Koa.js

- **Version:** 0.0.1-alpha.0 (Early Alpha)
- **Author:** Italo Paesano (italopaesano@protonmail.com)
- **License:** ISC

## Core Philosophy

**Zero Database Dependency** - ital8cms does not require any DBMS by default. The core system uses **JSON files** for structured data storage and **file-based storage** for content. Database systems like SQLite are **optional** and can be added through plugins when needed.

**Developer-First Approach** - This CMS is designed for developers who understand HTML, CSS, JavaScript, EJS templating, and Node.js. No drag-and-drop interfaces - all customization is done through code and configuration files.

## Key Features

- **Plugin-based architecture** with dynamic loading and dependency resolution
- **File-based storage** - no database installation required
- **JSON5 configuration** with comments and trailing commas support
- **Modular theme system** with EJS templates
- **Modern stack** - Koa v3.1.1, Node.js >=18
- **Session-based authentication** with RBAC
- **Bootstrap 5.3** integration

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm start
```

Server runs on: `http://localhost:3000`

## Documentation

### For Developers & AI Assistants

- **[CLAUDE.md](./CLAUDE.md)** - Complete guide for AI assistants and developers (root)

**[CLAUDE-DOC/](./CLAUDE-DOC/)** - Additional guides:

- **[CODING_STYLE.md](./CLAUDE-DOC/CODING_STYLE.md)** - Coding style and conventions
- **[MIGRATION_KOA_V3.md](./CLAUDE-DOC/MIGRATION_KOA_V3.md)** - Koa v3 migration guide

### Project Documentation

- **[EXPLAIN.md](./EXPLAIN.md)** - General project documentation (Italian)

## Technology Stack

**Backend:**
- Koa.js v3.1.1 (web framework)
- EJS v3.1.9 (templating)
- JSON5 v2.2.3 (config with comments)
- bcryptjs v3.0.2 (authentication)
- Bootstrap v5.3.2 (UI)

**Optional:**
- better-sqlite3 (SQLite database via dbApi plugin)
- ccxt v4.1.70 (cryptocurrency exchanges via ccxt plugin)

## Plugin System

ital8cms features a sophisticated plugin system:

- **Dynamic loading** with dependency resolution
- **Inter-plugin communication** via shared objects
- **Lifecycle hooks** (load, install, uninstall, upgrade)
- **Middleware registration**
- **Custom API routes** with automatic prefixing
- **Page hooks** for content injection

### Plugin Structure

```
plugins/myPlugin/
├── main.js                    # Plugin logic
├── pluginConfig.json5         # Configuration
└── pluginDescription.json5    # Metadata
```

## Theme System

Modular theme system with composable EJS partials:

```
themes/myTheme/
├── views/              # Reusable partials
│   ├── head.ejs
│   ├── header.ejs
│   ├── nav.ejs
│   ├── main.ejs
│   ├── aside.ejs
│   └── footer.ejs
└── templates/          # Complete page templates
```

## Data Storage

**Primary:** JSON5 files
- User accounts: `plugins/adminUsers/userAccount.json5`
- User roles: `plugins/adminUsers/userRole.json5`
- Plugin configs: `*/pluginConfig.json5`

**Optional:** SQLite database via dbApi plugin (currently disabled)

## Authentication

Session-based authentication with role-based access control (RBAC):

- **Roles:** root (0), admin (1), editor (2), viewer (3)
- **Protected paths:** `/reserved`, `/private`, `/lib`
- **Admin panel:** `/admin` (requires authentication)

## Project Structure

```
ital8cms/
├── index.js              # Application entry point
├── ital8Config.json5       # Main configuration
├── CLAUDE.md             # AI assistant guide
├── core/                 # Core CMS functionality
├── plugins/              # Plugin modules
├── themes/               # Theme templates
├── www/                  # Public web root
└── CLAUDE-DOC/           # Additional documentation
```

## Development

```bash
# Start with auto-reload
npm start

# Run tests
npm test

# Enable optional SQLite database
# 1. Edit plugins/dbApi/pluginConfig.json5: "active": 1
# 2. npm install better-sqlite3
# 3. Restart server
```

## License

ISC License - See package.json for details

## Author

**Italo Paesano**
- Email: italopaesano@protonmail.com
- GitHub: [@italopaesano](https://github.com/italopaesano)

---

**Note:** This project is in early alpha (v0.0.1-alpha.0). APIs and architecture may change.
