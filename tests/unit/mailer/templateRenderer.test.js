/**
 * Unit tests for mailer/lib/templateRenderer.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const TemplateRenderer = require('../../../plugins/mailer/lib/templateRenderer');

// ── Test helpers ──

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mailer-template-test-'));
}

function cleanupTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

/**
 * Creates a fake plugin folder with a templates/ subdirectory
 * and writes the given EJS files into it.
 *
 * @param {string} baseDir - Temp dir to write into
 * @param {Object} templates - { templateName: ejsContent }
 * @returns {string} pluginFolder path
 */
function createFakePluginFolder(baseDir, templates = {}) {
  const templatesDir = path.join(baseDir, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });

  for (const [name, content] of Object.entries(templates)) {
    fs.writeFileSync(path.join(templatesDir, `${name}.ejs`), content, 'utf8');
  }

  return baseDir;
}

// ══════════════════════════════════════════
// TemplateRenderer
// ══════════════════════════════════════════

describe('TemplateRenderer', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  // ── Initialization ──

  describe('initialization', () => {
    test('creates instance without throwing', () => {
      expect(() => new TemplateRenderer(tempDir)).not.toThrow();
    });

    test('sets templates dir to {pluginFolder}/templates', () => {
      const renderer = new TemplateRenderer(tempDir);
      expect(renderer._templatesDir).toBe(path.join(tempDir, 'templates'));
    });
  });

  // ── render() ──

  describe('render()', () => {
    test('renders a simple template with no variables', async () => {
      const pluginFolder = createFakePluginFolder(tempDir, {
        simple: '<h1>Ciao mondo</h1>',
      });
      const renderer = new TemplateRenderer(pluginFolder);
      const html = await renderer.render('simple', {});
      expect(html).toBe('<h1>Ciao mondo</h1>');
    });

    test('renders template with EJS variables', async () => {
      const pluginFolder = createFakePluginFolder(tempDir, {
        greeting: '<p>Ciao <%= name %>!</p>',
      });
      const renderer = new TemplateRenderer(pluginFolder);
      const html = await renderer.render('greeting', { name: 'Mario' });
      expect(html).toBe('<p>Ciao Mario!</p>');
    });

    test('renders template with multiple variables', async () => {
      const pluginFolder = createFakePluginFolder(tempDir, {
        email: '<p>Subject: <%= subject %></p><p>To: <%= to %></p>',
      });
      const renderer = new TemplateRenderer(pluginFolder);
      const html = await renderer.render('email', { subject: 'Test', to: 'user@example.com' });
      expect(html).toContain('Subject: Test');
      expect(html).toContain('To: user@example.com');
    });

    test('renders template with conditional blocks', async () => {
      const ejs = `<% if (typeof ctaUrl !== 'undefined' && ctaUrl) { %><a href="<%= ctaUrl %>">Click</a><% } else { %><p>No CTA</p><% } %>`;
      const pluginFolder = createFakePluginFolder(tempDir, { cta: ejs });
      const renderer = new TemplateRenderer(pluginFolder);

      const withCta    = await renderer.render('cta', { ctaUrl: 'https://example.com' });
      const withoutCta = await renderer.render('cta', {});

      expect(withCta).toContain('href="https://example.com"');
      expect(withoutCta).toContain('No CTA');
    });

    test('passes empty object when vars is omitted (undefined)', async () => {
      const pluginFolder = createFakePluginFolder(tempDir, {
        novar: '<p>static</p>',
      });
      const renderer = new TemplateRenderer(pluginFolder);
      // Should not throw even when vars is not provided
      const html = await renderer.render('novar', undefined);
      expect(html).toBe('<p>static</p>');
    });

    test('throws descriptive error when template does not exist', async () => {
      const pluginFolder = createFakePluginFolder(tempDir, {});
      const renderer = new TemplateRenderer(pluginFolder);

      await expect(renderer.render('nonexistent', {}))
        .rejects
        .toThrow(/nonexistent/);
    });

    test('error message for missing template includes expected path', async () => {
      const pluginFolder = createFakePluginFolder(tempDir, {});
      const renderer = new TemplateRenderer(pluginFolder);

      await expect(renderer.render('missing', {}))
        .rejects
        .toThrow(/missing\.ejs/);
    });

    test('throws descriptive error when EJS has syntax error', async () => {
      const pluginFolder = createFakePluginFolder(tempDir, {
        broken: '<p><%= undeclared_function_xyz() %></p>',
      });
      const renderer = new TemplateRenderer(pluginFolder);

      await expect(renderer.render('broken', {}))
        .rejects
        .toThrow(/broken/);
    });

    test('renders the built-in "example" template from the actual plugin', async () => {
      const actualPluginFolder = path.join(__dirname, '../../../plugins/mailer');
      const renderer = new TemplateRenderer(actualPluginFolder);

      const html = await renderer.render('example', {
        subject:  'Test subject',
        title:    'Test title',
        body:     'Test body content',
        ctaLabel: 'Click here',
        ctaUrl:   'https://example.com',
        footer:   'My Site',
      });

      expect(html).toContain('Test title');
      expect(html).toContain('Test body content');
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('My Site');
    });

    test('renders the built-in "welcome" template from the actual plugin', async () => {
      const actualPluginFolder = path.join(__dirname, '../../../plugins/mailer');
      const renderer = new TemplateRenderer(actualPluginFolder);

      const html = await renderer.render('welcome', {
        subject:        'Benvenuto!',
        username:       'Mario',
        activationLink: 'https://example.com/activate',
        siteName:       'Il Mio Sito',
      });

      expect(html).toContain('Mario');
      expect(html).toContain('Il Mio Sito');
      expect(html).not.toContain('<%'); // no unrendered EJS tags
    });
  });

  // ── list() ──

  describe('list()', () => {
    test('returns empty array when templates directory does not exist', () => {
      const renderer = new TemplateRenderer('/nonexistent/path/that/does/not/exist');
      expect(renderer.list()).toEqual([]);
    });

    test('returns empty array when templates directory is empty', () => {
      const pluginFolder = createFakePluginFolder(tempDir, {});
      const renderer = new TemplateRenderer(pluginFolder);
      expect(renderer.list()).toEqual([]);
    });

    test('returns template names without .ejs extension', () => {
      const pluginFolder = createFakePluginFolder(tempDir, {
        welcome: '<p>Welcome</p>',
        reset:   '<p>Reset</p>',
      });
      const renderer = new TemplateRenderer(pluginFolder);
      const list = renderer.list();
      expect(list).toContain('welcome');
      expect(list).toContain('reset');
      expect(list.every(name => !name.endsWith('.ejs'))).toBe(true);
    });

    test('returns sorted template names', () => {
      const pluginFolder = createFakePluginFolder(tempDir, {
        zebra:  '<p>Z</p>',
        alpha:  '<p>A</p>',
        middle: '<p>M</p>',
      });
      const renderer = new TemplateRenderer(pluginFolder);
      const list = renderer.list();
      expect(list).toEqual([...list].sort());
    });

    test('ignores non-.ejs files in templates directory', () => {
      const pluginFolder = createFakePluginFolder(tempDir, { mytemplate: '<p>OK</p>' });
      // Add a non-EJS file
      fs.writeFileSync(path.join(tempDir, 'templates', 'readme.txt'), 'docs', 'utf8');
      fs.writeFileSync(path.join(tempDir, 'templates', 'style.css'), 'body{}', 'utf8');

      const renderer = new TemplateRenderer(pluginFolder);
      const list = renderer.list();

      expect(list).toContain('mytemplate');
      expect(list).not.toContain('readme');
      expect(list).not.toContain('style');
    });

    test('returns both built-in plugin templates', () => {
      const actualPluginFolder = path.join(__dirname, '../../../plugins/mailer');
      const renderer = new TemplateRenderer(actualPluginFolder);
      const list = renderer.list();

      expect(list).toContain('example');
      expect(list).toContain('welcome');
    });
  });
});
