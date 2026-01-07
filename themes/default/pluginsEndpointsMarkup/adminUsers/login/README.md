# Theme Customization: adminUsers/login

This directory contains theme customizations for the `adminUsers/login` page.

## Files

### `style.css`
Custom CSS that gets auto-injected into the `<head>` of the login page.

**Features:**
- Gradient background
- Glass-morphism card design
- Smooth animations
- Responsive design

**Usage:** Automatically loaded when accessing `/pluginPages/adminUsers/login.ejs`

### `script.js`
Custom JavaScript that gets auto-injected into the `<head>` of the login page.

**Features:**
- Client-side validation (username min 3 chars, password min 6 chars)
- Auto-focus on first empty field
- Password visibility toggle
- Double-submit prevention
- Error message animations

**Usage:** Automatically loaded when accessing `/pluginPages/adminUsers/login.ejs`

### `before-content.html`
HTML injected BEFORE the `<main>` element.

**Content:** Branding header with "Welcome to ital8CMS" message

**Usage:** Automatically injected via `passData.themeSys.injectPluginHtmlBefore()`

### `after-content.html`
HTML injected AFTER the `<main>` element.

**Content:** Footer with "Powered by ital8CMS" and help link

**Usage:** Automatically injected via `passData.themeSys.injectPluginHtmlAfter()`

## How It Works

The Plugin Pages System automatically detects these files and injects them into the login page:

1. **Auto-Detection:** System detects plugin="adminUsers", page="login" from URL
2. **File Loading:** Checks for customization files in this directory
3. **Injection:** Automatically injects content during page render

## Template Integration

In the plugin template (`plugins/adminUsers/webPages/login.ejs`), these methods trigger injection:

```ejs
<%- passData.themeSys.injectPluginCss() %>        <!-- Injects style.css -->
<%- passData.themeSys.injectPluginJs() %>         <!-- Injects script.js -->
<%- passData.themeSys.injectPluginHtmlBefore() %> <!-- Injects before-content.html -->
<%- passData.themeSys.injectPluginHtmlAfter() %>  <!-- Injects after-content.html -->
```

## Testing

Access the customized login page:
```
http://localhost:3000/pluginPages/adminUsers/login.ejs
```

You should see:
- Purple gradient background
- Glass-morphism card with login form
- "Welcome to ital8CMS" branding header (before main)
- Footer with "Powered by ital8CMS" (after main)
- Client-side validation on form submit
- Password visibility toggle button

## Customization

To modify the design:
1. Edit the CSS in `style.css`
2. Edit the JavaScript logic in `script.js`
3. Edit the HTML in `before-content.html` or `after-content.html`
4. Reload the page - changes are immediate (no server restart needed)

## Removing Customizations

To remove theme customizations and use the default plugin template:
- Delete or rename this directory
- The login page will fall back to the plugin's default styling
