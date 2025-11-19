# CLAUDE.md - AI Assistant Guide for ital8cms

## Project Overview

**ital8cms** is a modular, plugin-based Content Management System built on Node.js and Koa.js. The architecture emphasizes extensibility through a sophisticated plugin system that supports dynamic loading, dependency resolution, and inter-plugin communication.

- **Version:** 0.0.1-alpha.0 (Early Alpha)
- **Author:** Italo Paesano (italopaesano@protonmail.com)
- **License:** ISC
- **Primary Language:** JavaScript (CommonJS)
- **Code Comments:** Mix of Italian and English (author is Italian)

## Codebase Structure

```
/home/user/ital8cms/
├── index.js                      # Main application entry point
├── ital8-conf.json              # Central configuration file
├── package.json                 # Node.js dependencies
│
├── core/                        # Core CMS functionality
│   ├── admin/                   # Admin interface
│   │   └── webPages/           # Admin EJS templates
│   │       ├── index.ejs       # Admin dashboard
│   │       └── userManagment/  # User CRUD interface
│   ├── priorityMiddlewares/    # Critical middleware configs
│   │   └── koaSession.json     # Session configuration
│   ├── pluginSys.js            # Plugin system manager
│   └── themeSys.js             # Theme system manager
│
├── plugins/                     # Plugin modules (each self-contained)
│   ├── dbApi/                  # Database API plugin
│   │   ├── main.js             # Plugin logic
│   │   ├── config-plugin.json  # Plugin configuration
│   │   ├── description-plugin.json # Plugin metadata
│   │   └── dbFile/             # SQLite database files
│   ├── simpleAccess/           # Authentication/authorization
│   │   ├── userAccount.json    # User credentials (bcrypt hashed)
│   │   └── userRole.json       # Role definitions
│   ├── admin/                  # Admin functionality
│   ├── bootstrap/              # Bootstrap CSS/JS integration
│   ├── media/                  # Media management
│   ├── ccxt/                   # Cryptocurrency exchange API
│   └── ostrukUtility/          # Utility functions
│
├── themes/                      # Theme templates
│   ├── default/                # Default theme
│   │   ├── views/              # Theme partials
│   │   │   ├── head.ejs        # HTML head
│   │   │   ├── header.ejs      # Header section
│   │   │   ├── nav.ejs         # Navigation
│   │   │   ├── main.ejs        # Main content area
│   │   │   ├── aside.ejs       # Sidebar
│   │   │   └── footer.ejs      # Footer + scripts
│   │   └── templates/          # Full page templates
│   └── baseExampleTheme/       # Example theme
│
└── www/                         # Public web root
    └── index.ejs               # Public homepage
```

## Technology Stack

### Backend
- **Framework:** Koa.js v2.14.2 (async/await-based web framework)
- **Routing:** @koa/router v12.0.1
- **Middleware:** koa-bodyparser, koa-session, koa-classic-server
- **Database:** better-sqlite3 v9.6.0 (SQLite)
- **Authentication:** bcryptjs v3.0.2 (password hashing)
- **Template Engine:** EJS v3.1.9
- **Utilities:** semver v7.5.4 (dependency versioning)

### Frontend
- **UI Framework:** Bootstrap v5.3.2
- **Templating:** Server-side EJS rendering

### Development
- **Auto-reload:** nodemon v3.0.1
- **Version Control:** Git

### Optional Integrations
- **ccxt v4.1.70:** Cryptocurrency exchange integration

## Application Startup Flow

Understanding the initialization sequence is critical:

1. **Load Koa Application** (`index.js`)
2. **Initialize Priority Middlewares:**
   - Body parser (request parsing)
   - Sessions (authentication state)
   - Router (URL routing)
3. **Initialize Plugin System** (`pluginSys`)
4. **Load Active Plugins:**
   - Resolve dependencies
   - Load in dependency order
   - Call `loadPlugin()` on each
   - Share objects between plugins
5. **Register Plugin Routes:**
   - Prefix: `/${apiPrefix}/${pluginName}`
   - Default: `/api/{pluginName}/...`
6. **Load Plugin Middlewares**
7. **Initialize Theme System** (`themeSys`)
8. **Setup Static Servers:**
   - Public site: `/www` directory → `/`
   - Admin panel: `/core/admin/webPages` → `/admin`
9. **Start HTTP Server** (port 3000 by default)

## Plugin System Architecture

The plugin system is the heart of ital8cms. Understanding it is essential.

### Plugin Structure

Every plugin must have this structure:

```
plugins/myPlugin/
├── main.js                    # Plugin logic (required)
├── config-plugin.json         # Configuration (required)
└── description-plugin.json    # Metadata (required)
```

### Plugin main.js Exports

A plugin's `main.js` can export these functions:

```javascript
module.exports = {
  // Lifecycle hooks
  async loadPlugin(pluginSys, pathPluginFolder) {},
  async installPlugin(pluginSys, pathPluginFolder) {},
  async uninstallPlugin(pluginSys, pathPluginFolder) {},
  async upgradePlugin(pluginSys, pathPluginFolder, oldVersion, newVersion) {},

  // Route registration
  getRouteArray(router, pluginSys, pathPluginFolder) { return [] },

  // Middleware registration
  getMiddlewareToAdd(pluginSys, pathPluginFolder) { return [] },

  // Object sharing
  getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) { return {} },
  setSharedObject(fromPlugin, sharedObject) {},

  // Page hooks
  getHooksPage(section, passData, pluginSys, pathPluginFolder) { return "" }
}
```

### config-plugin.json

```json
{
  "active": 1,                    // 0=disabled, 1=enabled
  "isInstalled": 1,               // Installation status
  "weight": 0,                    // Load priority (lower = earlier)
  "dependency": {                 // Plugin dependencies
    "pluginName": "^1.0.0"       // Semantic versioning
  },
  "nodeModuleDependency": {       // NPM dependencies
    "package": "^1.0.0"
  },
  "custom": {                     // Plugin-specific settings
    "setting1": "value1"
  }
}
```

### description-plugin.json

```json
{
  "name": "myPlugin",
  "version": "1.0.0",
  "description": "Plugin description",
  "author": "Your Name",
  "email": "email@example.com",
  "license": "MIT"
}
```

### Plugin Loading Order

Plugins are loaded by:
1. **Weight** (ascending: 0, 1, 2...)
2. **Dependency resolution** (dependencies loaded first)
3. **Alphabetical** (if weight is equal)

### Inter-Plugin Communication

Plugins share objects via:

```javascript
// In providing plugin (e.g., dbApi)
getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) {
  // Can customize what to share per requesting plugin
  if (forPlugin === 'simpleAccess') {
    return { db: this.userDb }
  }
  return { db: this.sharedDb }
}

// In receiving plugin
setSharedObject(fromPlugin, sharedObject) {
  if (fromPlugin === 'dbApi') {
    this.db = sharedObject.db
  }
}

// Access shared objects in other code
const dbApiShared = pluginSys.getSharedObject('dbApi')
```

### Plugin API Routes

Routes follow pattern: `/${apiPrefix}/${pluginName}/${path}`

```javascript
getRouteArray(router, pluginSys, pathPluginFolder) {
  return [
    {
      method: 'get',  // 'get', 'post', 'put', 'del', 'all'
      path: '/hello',
      func: async (ctx) => {
        ctx.body = 'Hello World'
      }
    }
  ]
}
```

Accessible at: `/api/myPlugin/hello`

### Page Hooks

Plugins can inject content into page sections:

```javascript
getHooksPage(section, passData, pluginSys, pathPluginFolder) {
  if (section === 'head') {
    return '<link rel="stylesheet" href="/my-styles.css">'
  }
  if (section === 'header') {
    return '<div>Injected header content</div>'
  }
  if (section === 'script') {
    return '<script src="/my-script.js"></script>'
  }
  return ''
}
```

Available sections: `head`, `header`, `body`, `footer`, `script`

## Theme System

### Theme Structure

```
themes/myTheme/
├── views/                    # Reusable partials
│   ├── head.ejs             # HTML head section
│   ├── header.ejs           # Page header
│   ├── nav.ejs              # Navigation
│   ├── main.ejs             # Main content
│   ├── aside.ejs            # Sidebar
│   └── footer.ejs           # Footer + closing tags
└── templates/               # Complete page templates
    └── page.ejs
```

### Theme Configuration

In `ital8-conf.json`:

```json
{
  "activeTheme": "default",        // Public site theme
  "adminActiveTheme": "default",   // Admin panel theme
  "baseThemePath": "../"           // Relative path base
}
```

### Using Theme Partials in EJS

```ejs
<%- await include(getThemePartPath('head', passData)) %>
<%- await include(getThemePartPath('header', passData)) %>
<%- await include(getThemePartPath('nav', passData)) %>
<%- await include(getThemePartPath('main', passData)) %>
<%- await include(getThemePartPath('aside', passData)) %>
<%- await include(getThemePartPath('footer', passData)) %>
```

### Admin Theme Partials

```ejs
<%- await include(getAdminThemePartPath('head', passData)) %>
<!-- etc. -->
```

### Plugin Hook Integration

Themes call `pluginSys.hookPage()` to allow plugins to inject content:

```ejs
<!-- In head.ejs -->
<%- await pluginSys.hookPage("head", passData) %>

<!-- In header.ejs -->
<%- await pluginSys.hookPage("header", passData) %>

<!-- In footer.ejs -->
<%- await pluginSys.hookPage("script", passData) %>
```

## Database Conventions

### Database Strategy

- **Technology:** SQLite via better-sqlite3
- **Location:** `/plugins/dbApi/dbFile/`
- **Per-Plugin Isolation:** Each plugin can have its own database

### Database Files

```
plugins/dbApi/dbFile/
├── mainDb.db              # Main application database
├── webDb.db               # Web-shared data (available in templates)
├── testDb.db              # Testing database
└── pluginsDb/             # Per-plugin databases
    ├── admin.db
    ├── simpleAccess.db
    └── media.db
```

### Accessing Databases in Plugins

```javascript
// Request database from dbApi
async loadPlugin(pluginSys, pathPluginFolder) {
  const dbApi = pluginSys.getSharedObject('dbApi')
  this.db = dbApi.db  // Or specific database
}

// dbApi creates isolated databases per plugin
getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) {
  const pluginDbPath = path.join(this.dbPluginsPath, `${forPlugin}.db`)
  const db = new Database(pluginDbPath)
  return { db }
}
```

### Database in Templates

The `webDb` is available in all EJS templates:

```ejs
<% const db = passData.plugin.dbApi.db %>
<%
  const data = db.prepare('SELECT * FROM my_table').all()
%>
```

### Current Data Storage

- **User accounts:** JSON file at `/plugins/simpleAccess/userAccount.json`
- **User roles:** JSON file at `/plugins/simpleAccess/userRole.json`
- **Future:** Migrate to SQLite for better performance and querying

## Authentication & Authorization

### Authentication System (simpleAccess plugin)

**Login Flow:**
1. User submits username/password to `/api/simpleAccess/login` (POST)
2. Plugin validates credentials against `userAccount.json`
3. Password verified with bcryptjs
4. Session created: `ctx.session.authenticated = true`, `ctx.session.user = userData`
5. Session cookie sent to client

**Logout Flow:**
1. User accesses `/api/simpleAccess/logout` (POST)
2. Session destroyed: `ctx.session = null`

**Session Management:**
- Signed cookies with secret keys
- Max age: 24 hours (86400000ms)
- Configuration: `/core/priorityMiddlewares/koaSession.json`

### Authorization System (RBAC)

**Roles:**
- **0 (root):** Full authorization, all operations
- **1 (admin):** Full access to all resources
- **2 (editor):** Create, read, update (no delete)
- **3 (viewer):** Read-only access

**Role Configuration:**
Located in `/plugins/simpleAccess/userRole.json`

### Access Control Middleware

Protected URL prefixes:
- `/reserved` - Requires authentication
- `/private` - Requires authentication
- `/lib` - Requires authentication

Returns 401 Unauthorized if not logged in.

### Checking Authentication in Code

```javascript
// In route handler
if (!ctx.session.authenticated) {
  ctx.status = 401
  ctx.body = 'Unauthorized'
  return
}

// Access user data
const username = ctx.session.user.username
const role = ctx.session.user.role
```

### Checking Authentication in Templates

```ejs
<% if (passData.ctx.session.authenticated) { %>
  <p>Welcome, <%= passData.ctx.session.user.username %>!</p>
<% } else { %>
  <p><a href="/api/simpleAccess/login">Login</a></p>
<% } %>
```

## API Route Patterns

### Standard API Routes

All plugin routes are prefixed: `/api/{pluginName}/...`

### SimpleAccess Plugin Routes

```
GET  /api/simpleAccess/login         # Display login form
POST /api/simpleAccess/login         # Authenticate user
GET  /api/simpleAccess/logout        # Display logout confirmation
POST /api/simpleAccess/logout        # End session
GET  /api/simpleAccess/logged        # Check login status (JSON)
GET  /api/simpleAccess/userList      # List all users (protected)
GET  /api/simpleAccess/userInfo      # Get user details (protected)
GET  /api/simpleAccess/roleList      # List all roles (protected)
POST /api/simpleAccess/usertUser     # Create/update user (protected)
```

### Bootstrap Plugin Routes

```
GET /api/bootstrap/css/bootstrap.min.css
GET /api/bootstrap/css/bootstrap.min.css.map
GET /api/bootstrap/js/bootstrap.min.js
GET /api/bootstrap/js/bootstrap.min.js.map
```

### Creating New Routes

1. Add route definition in plugin's `getRouteArray()`:

```javascript
getRouteArray(router, pluginSys, pathPluginFolder) {
  return [
    {
      method: 'get',
      path: '/my-endpoint',
      func: async (ctx) => {
        ctx.body = { message: 'Hello' }
      }
    },
    {
      method: 'post',
      path: '/create-item',
      func: async (ctx) => {
        const data = ctx.request.body
        // Process data
        ctx.body = { success: true }
      }
    }
  ]
}
```

2. Route becomes available at: `/api/yourPlugin/my-endpoint`

## Configuration Management

### Main Configuration: ital8-conf.json

```json
{
  "apiPrefix": "api",                 // API route prefix (change if needed)
  "adminPrefix": "admin",             // Admin panel path
  "enableAdmin": true,                // Enable/disable admin panel
  "viewsPrefix": "views",             // Views route prefix
  "baseThemePath": "../",             // Theme path base
  "activeTheme": "default",           // Public theme
  "adminActiveTheme": "default",      // Admin theme
  "wwwPath": "/www",                  // Public web root
  "debugMode": 1,                     // Debug level (0=off, 1=on)
  "httpPort": 3000,                   // HTTP port
  "useHttps": false,                  // Enable HTTPS
  "httpsPort": "",                    // HTTPS port
  "AutoRedirectHttpPortToHttpsPort": false
}
```

### Session Configuration: core/priorityMiddlewares/koaSession.json

**IMPORTANT:** Change session keys in production!

```json
{
  "keys": [
    "key.segretussimmmmmm",           // PRIMARY: Change this!
    "key.secondaryKey123"             // SECONDARY: Change this!
  ],
  "CONFIG": {
    "key": "koa:sess",
    "maxAge": 86400000,               // 24 hours
    "autoCommit": true,
    "overwrite": true,
    "httpOnly": true,
    "signed": true,
    "rolling": false,
    "renew": false
  }
}
```

### Plugin-Specific Configuration

Each plugin's `config-plugin.json`:

```json
{
  "custom": {
    "myPluginSetting": "value",
    "featureEnabled": true,
    "maxItems": 100
  }
}
```

Access in code:

```javascript
const config = require('./config-plugin.json')
const mySetting = config.custom.myPluginSetting
```

## passData Object Reference

The `passData` object is available in all EJS templates and contains:

```javascript
{
  apiPrefix: "api",              // API route prefix
  adminPrefix: "admin",          // Admin path (only in admin pages)
  pluginSys: pluginSys,          // Plugin system instance
  plugin: {                      // Plugin shared objects
    dbApi: { db: ... },
    simpleAccess: { ... },
    // ... other plugins
  },
  themeSys: themeSys,            // Theme system instance
  filePath: "/path/to/file.ejs", // Current template path
  href: "http://...",            // Full request URL
  query: { ... },                // URL query parameters
  ctx: ctx                       // Full Koa context
}
```

### Common passData Usage

```ejs
<!-- Access plugin shared objects -->
<% const db = passData.plugin.dbApi.db %>

<!-- Check authentication -->
<% if (passData.ctx.session.authenticated) { %>
  <!-- Authenticated content -->
<% } %>

<!-- Access query parameters -->
<% const page = passData.query.page || 1 %>

<!-- Get current URL -->
<p>Current URL: <%= passData.href %></p>

<!-- Call plugin hooks -->
<%- await passData.pluginSys.hookPage('header', passData) %>
```

## Development Workflows

### Starting Development

```bash
npm install        # Install dependencies
npm start          # Start with auto-reload (nodemon)
```

Server runs on: `http://localhost:3000`

### Creating a New Plugin

1. **Create plugin directory:**
```bash
mkdir plugins/myPlugin
```

2. **Create main.js:**
```javascript
module.exports = {
  async loadPlugin(pluginSys, pathPluginFolder) {
    console.log('MyPlugin loaded!')
  },

  getRouteArray(router, pluginSys, pathPluginFolder) {
    return [
      {
        method: 'get',
        path: '/hello',
        func: async (ctx) => {
          ctx.body = 'Hello from myPlugin!'
        }
      }
    ]
  }
}
```

3. **Create config-plugin.json:**
```json
{
  "active": 1,
  "isInstalled": 0,
  "weight": 100,
  "dependency": {},
  "nodeModuleDependency": {},
  "custom": {}
}
```

4. **Create description-plugin.json:**
```json
{
  "name": "myPlugin",
  "version": "1.0.0",
  "description": "My new plugin",
  "author": "Your Name",
  "email": "your@email.com",
  "license": "MIT"
}
```

5. **Restart server** - Plugin will auto-load

6. **Access route:** `http://localhost:3000/api/myPlugin/hello`

### Creating a New Theme

1. **Copy default theme:**
```bash
cp -r themes/default themes/myTheme
```

2. **Modify theme files** in `themes/myTheme/views/`

3. **Activate theme** in `ital8-conf.json`:
```json
{
  "activeTheme": "myTheme"
}
```

4. **Restart server**

### Adding Admin Pages

1. **Create EJS file** in `/core/admin/webPages/`:
```bash
mkdir -p core/admin/webPages/myFeature
```

2. **Create page** at `core/admin/webPages/myFeature/index.ejs`:
```ejs
<%- await include(getAdminThemePartPath('head', passData)) %>
<%- await include(getAdminThemePartPath('header', passData)) %>

<main>
  <h1>My Feature</h1>
  <!-- Your content -->
</main>

<%- await include(getAdminThemePartPath('footer', passData)) %>
```

3. **Access:** `http://localhost:3000/admin/myFeature/`

### User Management

**Access admin panel:**
- URL: `http://localhost:3000/admin`
- Login required (use simpleAccess plugin)

**User management interface:**
- `http://localhost:3000/admin/userManagment/`
- List users, add, edit, delete

**Default users** (check `plugins/simpleAccess/userAccount.json`):
```json
{
  "username": {
    "password": "$2a$10$hashedPassword",
    "email": "user@example.com",
    "role": 0
  }
}
```

### Database Operations

```javascript
// Get database from dbApi
const dbApi = pluginSys.getSharedObject('dbApi')
const db = dbApi.db

// Create table
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

// Insert data
const insert = db.prepare('INSERT INTO items (name) VALUES (?)')
insert.run('Item 1')

// Query data
const stmt = db.prepare('SELECT * FROM items')
const items = stmt.all()

// Query with parameters
const item = db.prepare('SELECT * FROM items WHERE id = ?').get(1)
```

## Code Conventions & Best Practices

### Naming Conventions

- **Variables/Functions:** camelCase (`myVariable`, `myFunction`)
- **Classes:** PascalCase (`PluginSystem`, `ThemeSystem`)
- **Files/Directories:** kebab-case (`my-plugin`, `user-management`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_ITEMS`, `API_PREFIX`)

### JavaScript Patterns

- **Module System:** CommonJS (`require`, `module.exports`)
- **Async:** Always use `async/await`, never callbacks
- **Middleware:** `async (ctx, next) => { await next() }`

### File Organization

- **Core logic:** `/core` directory
- **Extensions:** `/plugins` directory (self-contained)
- **UI:** `/themes` directory (composable)
- **Public:** `/www` directory (static + EJS)

### Comments

- Many comments are in Italian (author's native language)
- API and variable names are in English
- When adding comments, prefer English for international collaboration
- Document complex logic thoroughly

### Error Handling

```javascript
// Good: Try-catch for database operations
try {
  const result = db.prepare('SELECT * FROM items').all()
  ctx.body = result
} catch (error) {
  console.error('Database error:', error)
  ctx.status = 500
  ctx.body = { error: 'Internal server error' }
}

// Good: Validation
if (!username || !password) {
  ctx.status = 400
  ctx.body = { error: 'Username and password required' }
  return
}
```

### Security Best Practices

1. **Passwords:** Always use bcrypt hashing
```javascript
const bcrypt = require('bcryptjs')
const hashedPassword = await bcrypt.hash(password, 10)
const isValid = await bcrypt.compare(password, hashedPassword)
```

2. **Sessions:** Change default session keys in production

3. **Input Validation:** Validate all user input
```javascript
// Email validation
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
if (!emailRegex.test(email)) {
  return { error: 'Invalid email format' }
}

// Username validation
if (!/^[a-zA-Z0-9_-]{3,}$/.test(username)) {
  return { error: 'Invalid username' }
}
```

4. **SQL Injection:** Use prepared statements
```javascript
// Good
const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)

// Bad - vulnerable to SQL injection
const user = db.prepare(`SELECT * FROM users WHERE id = ${userId}`).get()
```

5. **Protected Routes:** Check authentication
```javascript
if (!ctx.session.authenticated) {
  ctx.status = 401
  ctx.body = 'Unauthorized'
  return
}
```

## Common Tasks

### Task: Add a New API Endpoint

```javascript
// In plugins/myPlugin/main.js
getRouteArray(router, pluginSys, pathPluginFolder) {
  return [
    {
      method: 'post',
      path: '/create-item',
      func: async (ctx) => {
        // Get request body
        const { name, description } = ctx.request.body

        // Validate
        if (!name) {
          ctx.status = 400
          ctx.body = { error: 'Name required' }
          return
        }

        // Process
        const db = pluginSys.getSharedObject('dbApi').db
        const stmt = db.prepare('INSERT INTO items (name, description) VALUES (?, ?)')
        const result = stmt.run(name, description)

        // Respond
        ctx.body = {
          success: true,
          id: result.lastInsertRowid
        }
      }
    }
  ]
}
```

### Task: Add Content to Every Page

```javascript
// In your plugin's main.js
getHooksPage(section, passData, pluginSys, pathPluginFolder) {
  if (section === 'header') {
    // Check if user is logged in
    if (passData.ctx.session.authenticated) {
      const username = passData.ctx.session.user.username
      return `<div class="user-info">Logged in as: ${username}</div>`
    }
  }
  return ''
}
```

### Task: Create a Database Table

```javascript
// In your plugin's loadPlugin() or installPlugin()
async loadPlugin(pluginSys, pathPluginFolder) {
  const db = pluginSys.getSharedObject('dbApi').db

  // Create table
  db.exec(`
    CREATE TABLE IF NOT EXISTS my_table (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Create index
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_my_table_name
    ON my_table(name)
  `)
}
```

### Task: Add Middleware

```javascript
// In your plugin's main.js
getMiddlewareToAdd(pluginSys, pathPluginFolder) {
  return [
    {
      func: async (ctx, next) => {
        // Log all requests
        console.log(`${ctx.method} ${ctx.url}`)
        await next()
      }
    },
    {
      func: async (ctx, next) => {
        // Add custom header
        ctx.set('X-Powered-By', 'ital8cms')
        await next()
      }
    }
  ]
}
```

### Task: Share Data Between Plugins

```javascript
// Provider plugin (e.g., myDataPlugin)
module.exports = {
  data: { items: [] },

  getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) {
    return {
      data: this.data,
      addItem: (item) => this.data.items.push(item),
      getItems: () => this.data.items
    }
  }
}

// Consumer plugin
module.exports = {
  myDataApi: null,

  setSharedObject(fromPlugin, sharedObject) {
    if (fromPlugin === 'myDataPlugin') {
      this.myDataApi = sharedObject
    }
  },

  async loadPlugin(pluginSys, pathPluginFolder) {
    // Use shared API
    this.myDataApi.addItem({ name: 'Test' })
    const items = this.myDataApi.getItems()
  }
}
```

## Testing Strategy

**Current Status:** No formal testing framework configured.

### Recommendations for Testing

1. **Add Jest or Mocha:**
```bash
npm install --save-dev jest
```

2. **Create test directory:**
```
tests/
├── unit/
│   ├── plugins/
│   └── core/
└── integration/
    └── api/
```

3. **Write tests for:**
- Plugin loading and dependency resolution
- Authentication flows
- API endpoints
- Database operations
- Theme rendering

4. **Update package.json:**
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch"
  }
}
```

## Deployment Guidelines

### Pre-Production Checklist

- [ ] Change session keys in `core/priorityMiddlewares/koaSession.json`
- [ ] Set appropriate `httpPort` or enable HTTPS
- [ ] Review and secure admin path (`adminPrefix`)
- [ ] Enable authentication for admin routes
- [ ] Set `debugMode: 0` in production
- [ ] Review user roles and permissions
- [ ] Backup database files
- [ ] Set up proper logging
- [ ] Configure reverse proxy (nginx/Apache)
- [ ] Set up SSL certificates if using HTTPS

### Production Deployment

1. **Install dependencies:**
```bash
npm install --production
```

2. **Run application:**
```bash
node index.js
```

3. **Use process manager (recommended):**
```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start index.js --name ital8cms

# Auto-restart on reboot
pm2 startup
pm2 save
```

4. **Reverse proxy (nginx example):**
```nginx
server {
  listen 80;
  server_name example.com;

  location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }
}
```

### Environment-Based Configuration

**Future Enhancement:** Consider using environment variables:

```javascript
// Load from .env file
const httpPort = process.env.HTTP_PORT || 3000
const debugMode = process.env.DEBUG_MODE === 'true' ? 1 : 0
```

## Important Files Reference

### Configuration Files

- `/ital8-conf.json` - Main application configuration
- `/core/priorityMiddlewares/koaSession.json` - Session configuration
- `/plugins/*/config-plugin.json` - Per-plugin configuration
- `/plugins/*/description-plugin.json` - Plugin metadata

### Entry Points

- `/index.js` - Application bootstrap
- `/core/pluginSys.js` - Plugin system manager
- `/core/themeSys.js` - Theme system manager

### Authentication

- `/plugins/simpleAccess/userAccount.json` - User credentials
- `/plugins/simpleAccess/userRole.json` - Role definitions
- `/plugins/simpleAccess/main.js` - Authentication logic

### Databases

- `/plugins/dbApi/dbFile/mainDb.db` - Main database
- `/plugins/dbApi/dbFile/webDb.db` - Web-shared database
- `/plugins/dbApi/dbFile/pluginsDb/*.db` - Per-plugin databases

### Admin Interface

- `/core/admin/webPages/index.ejs` - Admin dashboard
- `/core/admin/webPages/userManagment/` - User management UI

## Debugging & Troubleshooting

### Enable Debug Mode

In `ital8-conf.json`:
```json
{
  "debugMode": 1
}
```

### Check Plugin Loading

Plugins log during load:
```
Loading plugin: dbApi
Loading plugin: simpleAccess
Plugin loaded: dbApi
Plugin loaded: simpleAccess
```

### Common Issues

**Plugin not loading:**
- Check `config-plugin.json` has `"active": 1`
- Verify `description-plugin.json` exists
- Check dependencies are satisfied
- Look for syntax errors in `main.js`

**Routes not working:**
- Verify plugin is active and loaded
- Check route path in `getRouteArray()`
- Access at `/api/{pluginName}/{path}`
- Check middleware isn't blocking request

**Database errors:**
- Ensure dbApi plugin is active
- Check database file permissions
- Verify table exists before querying
- Use try-catch for database operations

**Authentication issues:**
- Verify session keys are set
- Check user exists in `userAccount.json`
- Ensure password is bcrypt hashed
- Check session cookie is being sent

**Theme not rendering:**
- Verify theme exists in `/themes` directory
- Check `activeTheme` in `ital8-conf.json`
- Ensure all required partials exist
- Look for EJS syntax errors

### VSCode Debugging

Launch configuration (`.vscode/launch.json`):
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Launch Program",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/index.js",
      "restart": true,
      "runtimeExecutable": "nodemon",
      "console": "integratedTerminal"
    }
  ]
}
```

## Future Improvements

Based on the codebase analysis, consider these enhancements:

1. **Testing:** Add Jest/Mocha for unit and integration tests
2. **TypeScript:** Migrate to TypeScript for type safety
3. **Environment Variables:** Use .env for configuration
4. **Database Migrations:** Implement migration system for schema changes
5. **API Documentation:** Add Swagger/OpenAPI documentation
6. **Error Handling:** Centralized error handling middleware
7. **Logging:** Structured logging (Winston, Bunyan)
8. **Validation:** Request validation library (Joi, Yup)
9. **Build Process:** Frontend asset bundling (webpack, esbuild)
10. **Internationalization:** i18n support for multiple languages

## Quick Reference Commands

```bash
# Development
npm install                    # Install dependencies
npm start                      # Start with auto-reload
node index.js                  # Start without auto-reload

# Production
npm install --production       # Install production dependencies only
node index.js                  # Run application
pm2 start index.js             # Run with PM2 process manager

# Database
# Access via better-sqlite3 in plugin code
# Files: /plugins/dbApi/dbFile/*.db

# Git
git status                     # Check status
git add .                      # Stage changes
git commit -m "message"        # Commit changes
git push                       # Push to remote
```

## AI Assistant Guidelines

When working on this codebase as an AI assistant:

1. **Understand Plugin Architecture:** This is a plugin-based system. Most features should be implemented as plugins.

2. **Respect Dependencies:** Check plugin dependencies and loading order before making changes.

3. **Use Existing Patterns:** Follow established patterns for routes, middleware, and hooks.

4. **Security First:** Always hash passwords, validate input, use prepared statements.

5. **Test Changes:** After modifications, verify:
   - Server starts without errors
   - Plugin loads successfully
   - Routes are accessible
   - Authentication still works

6. **Documentation:** Update this file when adding significant features or changing architecture.

7. **Italian Comments:** Author uses Italian comments. When adding comments, prefer English for international collaboration, but respect existing Italian comments.

8. **Version Control:** This is an alpha project (v0.0.1-alpha.0). Breaking changes are acceptable but should be documented.

9. **Configuration Changes:** When modifying configuration, update relevant JSON files and document changes.

10. **Theme Changes:** If modifying themes, ensure both public and admin themes are considered.

---

**Last Updated:** 2025-11-19
**Version:** 1.0.0
**Maintained By:** AI Assistant (based on codebase analysis)
