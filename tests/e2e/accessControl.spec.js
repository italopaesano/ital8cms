// @ts-check
const { test, expect } = require('@playwright/test');
const { TEST_PASSWORD, TEST_USERS, URLS } = require('./testConstants');

/**
 * E2E Tests: Access Control System
 *
 * Testa il sistema di controllo accessi basato su pattern:
 * - Hardcoded rules (/admin/**)
 * - Custom rules (user profile)
 * - Default policy (public pages)
 * - Role-based access
 * - Access denied page
 * - Access control API endpoints
 */

// Helper: login via form submission
async function loginAs(page, username, password) {
  await page.goto(URLS.loginPage);
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
}

// ========================================================================
// Hardcoded Rules - /admin/** protection
// ========================================================================
test.describe('Hardcoded Rules - Admin Protection', () => {
  test('unauthenticated user should be redirected from /admin/', async ({ page }) => {
    const response = await page.request.get('/admin/', { maxRedirects: 0 });
    expect(response.status()).toBe(302);

    const location = response.headers()['location'];
    expect(location).toContain('login.ejs');
  });

  test('unauthenticated user should be redirected from /admin/systemSettings/', async ({ page }) => {
    const response = await page.request.get('/admin/systemSettings/index.ejs', {
      maxRedirects: 0
    });
    expect(response.status()).toBe(302);
  });

  test('admin user (role 1) should access /admin/', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.username, TEST_PASSWORD);
    const response = await page.goto('/admin/');
    expect(response.status()).toBe(200);
  });

  test('root user (role 0) should access /admin/', async ({ page }) => {
    await loginAs(page, TEST_USERS.root.username, TEST_PASSWORD);
    const response = await page.goto('/admin/');
    expect(response.status()).toBe(200);
  });

  test('editor user (role 2) should be denied from /admin/', async ({ page }) => {
    await loginAs(page, TEST_USERS.editor.username, TEST_PASSWORD);
    await page.goto('/admin/');
    // Editor is authenticated but has wrong role - should see access-denied page
    expect(page.url()).toContain('access-denied');
  });

  test('selfEditor user (role 3) should be denied from /admin/', async ({ page }) => {
    await loginAs(page, TEST_USERS.selfEditor.username, TEST_PASSWORD);
    await page.goto('/admin/');
    expect(page.url()).toContain('access-denied');
  });
});

// ========================================================================
// Custom Rules - User Profile Protection
// ========================================================================
test.describe('Custom Rules - User Profile Protection', () => {
  test('unauthenticated user should be redirected from user profile', async ({ page }) => {
    const response = await page.request.get(URLS.userProfile, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
  });

  test('any authenticated user should access user profile (allowedRoles: [])', async ({ page }) => {
    // Editor (role 2) - allowed because allowedRoles is empty (any auth)
    await loginAs(page, TEST_USERS.editor.username, TEST_PASSWORD);
    const response = await page.goto(URLS.userProfile);
    expect(response.status()).toBe(200);
  });

  test('selfEditor should access user profile (allowedRoles: [])', async ({ page }) => {
    await loginAs(page, TEST_USERS.selfEditor.username, TEST_PASSWORD);
    const response = await page.goto(URLS.userProfile);
    expect(response.status()).toBe(200);
  });
});

// ========================================================================
// Default Policy - Public Pages
// ========================================================================
test.describe('Default Policy - Public Access', () => {
  test('public pages should be accessible without login (default: allow)', async ({ page }) => {
    const response = await page.goto('/');
    expect(response.status()).toBe(200);
  });

  test('login page should be accessible (no matching rule, default: allow)', async ({ page }) => {
    const response = await page.goto(URLS.loginPage);
    expect(response.status()).toBe(200);
  });
});

// ========================================================================
// Access Denied Page
// ========================================================================
test.describe('Access Denied Page', () => {
  test('access denied page should load for authenticated wrong-role user', async ({ page }) => {
    await loginAs(page, TEST_USERS.editor.username, TEST_PASSWORD);

    // Try to access admin - should be redirected to access-denied
    await page.goto('/admin/');
    await expect(page.locator('body')).toBeVisible();
    expect(page.url()).toContain('access-denied');
  });

  test('access denied page should be viewable', async ({ page }) => {
    // Access denied page itself should be publicly accessible
    const response = await page.goto(URLS.accessDenied);
    expect(response.status()).toBe(200);
  });
});

// ========================================================================
// Access Control API Endpoints
// ========================================================================
test.describe('Access Control API - Admin Only', () => {
  test('rules API should reject unauthenticated requests', async ({ page }) => {
    const response = await page.request.get('/api/adminAccessControl/rules', {
      maxRedirects: 0
    });
    expect([401, 302, 403]).toContain(response.status());
  });

  test('rules-json API should reject unauthenticated requests', async ({ page }) => {
    const response = await page.request.get('/api/adminAccessControl/rules-json', {
      maxRedirects: 0
    });
    expect([401, 302, 403]).toContain(response.status());
  });

  test('admin user should access rules API', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.username, TEST_PASSWORD);

    const response = await page.request.get('/api/adminAccessControl/rules');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('hardcodedRules');
    expect(data.data).toHaveProperty('customRules');
    expect(data.data).toHaveProperty('defaultPolicy');
  });

  test('admin user should access rules-json API', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.username, TEST_PASSWORD);

    const response = await page.request.get('/api/adminAccessControl/rules-json');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(typeof data.data).toBe('string'); // JSON5 string
  });

  test('test-access API should work for admin', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.username, TEST_PASSWORD);

    const response = await page.request.post('/api/adminAccessControl/test-access', {
      data: {
        url: '/admin/dashboard',
        roleIds: [2] // editor role
      }
    });
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('allowed');
    // Editor should NOT be allowed to admin
    expect(data.data.allowed).toBe(false);
  });

  test('test-access should confirm admin role is allowed', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.username, TEST_PASSWORD);

    const response = await page.request.post('/api/adminAccessControl/test-access', {
      data: {
        url: '/admin/dashboard',
        roleIds: [1] // admin role
      }
    });
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.data.allowed).toBe(true);
  });
});

// ========================================================================
// Multiple Roles - Access with Combined Roles
// ========================================================================
test.describe('Role Verification via Test-Access API', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.root.username, TEST_PASSWORD);
  });

  test('root role (0) should be allowed to admin', async ({ page }) => {
    const response = await page.request.post('/api/adminAccessControl/test-access', {
      data: { url: '/admin/', roleIds: [0] }
    });
    const data = await response.json();
    expect(data.data.allowed).toBe(true);
  });

  test('editor role (2) should be denied from admin', async ({ page }) => {
    const response = await page.request.post('/api/adminAccessControl/test-access', {
      data: { url: '/admin/', roleIds: [2] }
    });
    const data = await response.json();
    expect(data.data.allowed).toBe(false);
  });

  test('selfEditor role (3) should be denied from admin', async ({ page }) => {
    const response = await page.request.post('/api/adminAccessControl/test-access', {
      data: { url: '/admin/', roleIds: [3] }
    });
    const data = await response.json();
    expect(data.data.allowed).toBe(false);
  });

  test('user profile should be accessible by any authenticated user', async ({ page }) => {
    const response = await page.request.post('/api/adminAccessControl/test-access', {
      data: { url: '/pluginPages/adminUsers/userProfile.ejs', roleIds: [3] }
    });
    const data = await response.json();
    expect(data.data.allowed).toBe(true);
  });

  test('public page should be accessible by unauthenticated user', async ({ page }) => {
    const response = await page.request.post('/api/adminAccessControl/test-access', {
      data: { url: '/some-public-page.ejs', roleIds: [] }
    });
    const data = await response.json();
    // Default policy is "allow", but checkAccess with empty roleIds...
    // The test-access endpoint passes user = { roleIds: [] }
    expect(data.data.allowed).toBe(true);
  });
});
