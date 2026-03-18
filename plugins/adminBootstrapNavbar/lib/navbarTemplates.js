/**
 * navbarTemplates.js
 *
 * Predefined navbar templates for quick creation.
 * Each template returns a JSON5 string with a complete navbar configuration.
 */

const templates = {
  horizontalBase: {
    id: 'horizontalBase',
    label: {
      it: 'Orizzontale Base',
      en: 'Horizontal Base',
    },
    description: {
      it: 'Navbar orizzontale minima con struttura base',
      en: 'Minimal horizontal navbar with basic structure',
    },
    generate: (navbarName) => `// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "settings": {
    "type": "horizontal",
    "colorScheme": "dark",
    "bgClass": "bg-primary",
    "expandAt": "lg",
    "containerClass": "container-fluid",
    "autoActive": true,
    "id": "${navbarName}",
  },

  "sections": {
    "left": [
      { "label": "Home", "href": "/" },
    ],
    "right": [],
  },
}
`,
  },

  horizontalComplete: {
    id: 'horizontalComplete',
    label: {
      it: 'Orizzontale Completo',
      en: 'Horizontal Complete',
    },
    description: {
      it: 'Navbar orizzontale con dropdown, separator e item autenticazione',
      en: 'Horizontal navbar with dropdown, separator and auth items',
    },
    generate: (navbarName) => `// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "settings": {
    "type": "horizontal",
    "colorScheme": "dark",
    "bgClass": "bg-primary",
    "expandAt": "lg",
    "containerClass": "container-fluid",
    "autoActive": true,
    "id": "${navbarName}",
  },

  "sections": {
    "left": [
      { "label": "Home", "href": "/", "icon": "<i class='bi bi-house'></i>" },
      {
        "type": "dropdown",
        "label": "Pages",
        "icon": "<i class='bi bi-file-earmark'></i>",
        "items": [
          { "label": "Page 1", "href": "/page1.ejs" },
          { "type": "divider" },
          { "label": "Page 2", "href": "/page2.ejs" },
        ],
      },
      { "type": "separator" },
      { "label": "Admin", "href": "/admin", "icon": "<i class='bi bi-gear'></i>", "requiresAuth": true, "allowedRoles": [0, 1] },
    ],
    "right": [
      { "label": "Login", "href": "/pluginPages/adminUsers/login.ejs", "icon": "<i class='bi bi-box-arrow-in-right'></i>", "showWhen": "unauthenticated" },
      { "label": "Logout", "href": "/pluginPages/adminUsers/logout.ejs", "icon": "<i class='bi bi-box-arrow-right'></i>", "showWhen": "authenticated" },
    ],
  },
}
`,
  },

  sidebar: {
    id: 'sidebar',
    label: {
      it: 'Sidebar Verticale',
      en: 'Vertical Sidebar',
    },
    description: {
      it: 'Navbar verticale per layout a sidebar',
      en: 'Vertical navbar for sidebar layout',
    },
    generate: (navbarName) => `// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "settings": {
    "type": "vertical",
    "colorScheme": "dark",
    "bgClass": "bg-dark",
    "position": "start",
    "autoActive": true,
    "id": "${navbarName}",
  },

  "sections": {
    "left": [
      { "label": "Home", "href": "/", "icon": "<i class='bi bi-house'></i>" },
      { "label": "Dashboard", "href": "/dashboard.ejs", "icon": "<i class='bi bi-speedometer2'></i>" },
      {
        "type": "dropdown",
        "label": "Settings",
        "icon": "<i class='bi bi-gear'></i>",
        "items": [
          { "label": "General", "href": "/settings/general.ejs" },
          { "label": "Advanced", "href": "/settings/advanced.ejs" },
        ],
      },
    ],
    "right": [
      { "label": "Logout", "href": "/pluginPages/adminUsers/logout.ejs", "icon": "<i class='bi bi-box-arrow-right'></i>", "showWhen": "authenticated" },
    ],
  },
}
`,
  },

  offcanvasResponsive: {
    id: 'offcanvasResponsive',
    label: {
      it: 'Offcanvas Responsive',
      en: 'Responsive Offcanvas',
    },
    description: {
      it: 'Menu hamburger che si attiva sotto il breakpoint',
      en: 'Hamburger menu that activates below the breakpoint',
    },
    generate: (navbarName) => `// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "settings": {
    "type": "offcanvas",
    "colorScheme": "dark",
    "bgClass": "bg-primary",
    "expandAt": "lg",
    "containerClass": "container-fluid",
    "offcanvasAlways": false,
    "position": "start",
    "autoActive": true,
    "id": "${navbarName}",
  },

  "sections": {
    "left": [
      { "label": "Home", "href": "/", "icon": "<i class='bi bi-house'></i>" },
      { "label": "About", "href": "/about.ejs", "icon": "<i class='bi bi-info-circle'></i>" },
      { "label": "Contact", "href": "/contact.ejs", "icon": "<i class='bi bi-envelope'></i>" },
    ],
    "right": [
      { "label": "Login", "href": "/pluginPages/adminUsers/login.ejs", "showWhen": "unauthenticated" },
      { "label": "Logout", "href": "/pluginPages/adminUsers/logout.ejs", "showWhen": "authenticated" },
    ],
  },
}
`,
  },

  offcanvasAlways: {
    id: 'offcanvasAlways',
    label: {
      it: 'Offcanvas Sempre Visibile',
      en: 'Always-Visible Offcanvas',
    },
    description: {
      it: 'Menu hamburger sempre visibile, scorre da destra',
      en: 'Always-visible hamburger menu, slides from right',
    },
    generate: (navbarName) => `// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "settings": {
    "type": "offcanvas",
    "colorScheme": "light",
    "bgClass": "bg-light",
    "expandAt": "lg",
    "containerClass": "container-fluid",
    "offcanvasAlways": true,
    "position": "end",
    "autoActive": true,
    "id": "${navbarName}",
  },

  "sections": {
    "left": [
      { "label": "Home", "href": "/", "icon": "<i class='bi bi-house'></i>" },
      { "label": "Services", "href": "/services.ejs", "icon": "<i class='bi bi-grid'></i>" },
      {
        "type": "dropdown",
        "label": "More",
        "items": [
          { "label": "FAQ", "href": "/faq.ejs" },
          { "label": "Support", "href": "/support.ejs" },
        ],
      },
    ],
    "right": [
      { "label": "Login", "href": "/pluginPages/adminUsers/login.ejs", "showWhen": "unauthenticated" },
      { "label": "Profile", "href": "/pluginPages/adminUsers/userProfile.ejs", "showWhen": "authenticated" },
    ],
  },
}
`,
  },
};

/**
 * Returns the list of available templates (for UI display)
 * @returns {Array<object>} - Array of { id, label, description }
 */
function getTemplateList() {
  return Object.values(templates).map(t => ({
    id: t.id,
    label: t.label,
    description: t.description,
  }));
}

/**
 * Generates a navbar config string from a template
 * @param {string} templateId - Template ID
 * @param {string} navbarName - Name for the navbar (used as settings.id)
 * @returns {string|null} - JSON5 config string or null if template not found
 */
function generateFromTemplate(templateId, navbarName) {
  const template = templates[templateId];
  if (!template) return null;
  return template.generate(navbarName);
}

/**
 * Generates an empty navbar config
 * @param {string} navbarName - Name for the navbar
 * @returns {string} - JSON5 config string
 */
function generateEmpty(navbarName) {
  return `// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "settings": {
    "type": "horizontal",
    "colorScheme": "dark",
    "bgClass": "bg-primary",
    "expandAt": "lg",
    "containerClass": "container-fluid",
    "autoActive": true,
    "id": "${navbarName}",
  },

  "sections": {
    "left": [],
    "right": [],
  },
}
`;
}

module.exports = {
  getTemplateList,
  generateFromTemplate,
  generateEmpty,
};
