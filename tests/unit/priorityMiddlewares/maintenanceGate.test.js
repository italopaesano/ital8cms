const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMaintenanceGate, isExemptPath } = require('../../../core/priorityMiddlewares/maintenanceGate');

describe('isExemptPath', () => {
  test('lets /admin/* through', () => {
    expect(isExemptPath('/admin/index.ejs', 'admin', 'admin-theme-resources', '')).toBe(true);
    expect(isExemptPath('/admin/usersManagment/index.ejs', 'admin', 'admin-theme-resources', '')).toBe(true);
  });

  test('lets /admin-theme-resources/* through', () => {
    expect(isExemptPath('/admin-theme-resources/css/theme.css', 'admin', 'admin-theme-resources', '')).toBe(true);
  });

  test('intercepts /', () => {
    expect(isExemptPath('/', 'admin', 'admin-theme-resources', '')).toBe(false);
  });

  test('intercepts /api/anyplugin/login', () => {
    expect(isExemptPath('/api/adminUsers/login', 'admin', 'admin-theme-resources', '')).toBe(false);
  });

  test('intercepts /pluginPages/*', () => {
    expect(isExemptPath('/pluginPages/adminUsers/login.ejs', 'admin', 'admin-theme-resources', '')).toBe(false);
  });

  test('intercepts /public-theme-resources/* (per design)', () => {
    expect(isExemptPath('/public-theme-resources/css/main.css', 'admin', 'admin-theme-resources', '')).toBe(false);
  });

  test('honours custom globalPrefix', () => {
    expect(isExemptPath('/myapp/admin/x', 'admin', 'admin-theme-resources', '/myapp')).toBe(true);
    expect(isExemptPath('/admin/x', 'admin', 'admin-theme-resources', '/myapp')).toBe(false);
  });

  test('honours custom adminPrefix', () => {
    expect(isExemptPath('/backoffice/x', 'backoffice', 'admin-theme-resources', '')).toBe(true);
    expect(isExemptPath('/admin/x', 'backoffice', 'admin-theme-resources', '')).toBe(false);
  });
});

describe('createMaintenanceGate', () => {
  function tmpPagePath(html) {
    const p = path.join(os.tmpdir(), `mg-page-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ejs`);
    fs.writeFileSync(p, html, 'utf8');
    return p;
  }

  function fakeCtx(reqPath) {
    return {
      path: reqPath,
      status: 200,
      type: null,
      body: null,
      _headers: {},
      set(name, value) { this._headers[name] = value; },
    };
  }

  test('middleware lets through when state is "running"', async () => {
    const gate = createMaintenanceGate({
      ital8Conf: { adminPrefix: 'admin', adminThemeResourcesPrefix: 'admin-theme-resources' },
      projectRoot: __dirname,
      initialState: 'running',
    });
    const ctx = fakeCtx('/');
    let nextCalled = false;
    await gate.middleware(ctx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(ctx.status).toBe(200);
  });

  test('middleware intercepts public routes when stopped', async () => {
    const page = tmpPagePath('<h1>Torniamo subito</h1><p>retry=<%= retryAfterSeconds %></p>');
    try {
      const gate = createMaintenanceGate({
        ital8Conf: {
          adminPrefix: 'admin',
          adminThemeResourcesPrefix: 'admin-theme-resources',
          maintenance: { pagePath: page, retryAfterSeconds: 120 },
        },
        projectRoot: __dirname,
        initialState: 'stopped',
      });
      const ctx = fakeCtx('/');
      await gate.middleware(ctx, async () => { throw new Error('next should not be called'); });
      expect(ctx.status).toBe(503);
      expect(ctx._headers['Retry-After']).toBe('120');
      expect(ctx._headers['X-Robots-Tag']).toBe('noindex');
      expect(ctx.body).toContain('Torniamo subito');
      expect(ctx.body).toContain('retry=120');
    } finally { fs.unlinkSync(page); }
  });

  test('middleware lets /admin/* through even when stopped', async () => {
    const page = tmpPagePath('<h1>down</h1>');
    try {
      const gate = createMaintenanceGate({
        ital8Conf: {
          adminPrefix: 'admin',
          adminThemeResourcesPrefix: 'admin-theme-resources',
          maintenance: { pagePath: page },
        },
        projectRoot: __dirname,
        initialState: 'stopped',
      });
      const ctx = fakeCtx('/admin/usersManagment/');
      let nextCalled = false;
      await gate.middleware(ctx, async () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
      expect(ctx.status).toBe(200);
    } finally { fs.unlinkSync(page); }
  });

  test('setState/getState toggle behaviour live', async () => {
    const page = tmpPagePath('<h1>down</h1>');
    try {
      const gate = createMaintenanceGate({
        ital8Conf: {
          adminPrefix: 'admin',
          adminThemeResourcesPrefix: 'admin-theme-resources',
          maintenance: { pagePath: page },
        },
        projectRoot: __dirname,
        initialState: 'running',
      });
      expect(gate.getState()).toBe('running');

      const ctx1 = fakeCtx('/');
      let called1 = false;
      await gate.middleware(ctx1, async () => { called1 = true; });
      expect(called1).toBe(true);

      gate.setState('stopped');
      expect(gate.getState()).toBe('stopped');
      const ctx2 = fakeCtx('/');
      await gate.middleware(ctx2, async () => { throw new Error('should not be called'); });
      expect(ctx2.status).toBe(503);

      gate.setState('running');
      const ctx3 = fakeCtx('/');
      let called3 = false;
      await gate.middleware(ctx3, async () => { called3 = true; });
      expect(called3).toBe(true);
    } finally { fs.unlinkSync(page); }
  });

  test('setState rejects invalid states', () => {
    const page = tmpPagePath('<h1>down</h1>');
    try {
      const gate = createMaintenanceGate({
        ital8Conf: {
          adminPrefix: 'admin',
          adminThemeResourcesPrefix: 'admin-theme-resources',
          maintenance: { pagePath: page },
        },
        projectRoot: __dirname,
        initialState: 'running',
      });
      expect(() => gate.setState('paused')).toThrow();
    } finally { fs.unlinkSync(page); }
  });

  test('falls back to inline HTML when page template is missing', async () => {
    const gate = createMaintenanceGate({
      ital8Conf: {
        adminPrefix: 'admin',
        adminThemeResourcesPrefix: 'admin-theme-resources',
        maintenance: { pagePath: '/nonexistent/page.ejs', retryAfterSeconds: 60 },
      },
      projectRoot: __dirname,
      initialState: 'stopped',
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ctx = fakeCtx('/');
      await gate.middleware(ctx, async () => { throw new Error('next should not be called'); });
      expect(ctx.status).toBe(503);
      expect(ctx.body).toContain('Torniamo subito');
    } finally { warn.mockRestore(); }
  });
});
