// @ts-check
const { test, expect } = require('@playwright/test');
const { TEST_PASSWORD, TEST_USERS, URLS } = require('./testConstants');

/**
 * E2E Tests: Protected Routes
 *
 * Verifica che URL protetti restino inaccessibili senza autenticazione
 * e che URL pubblici siano sempre accessibili.
 *
 * Copre:
 * - Reserved paths (/reserved, /private, /lib) - middleware adminUsers
 * - Admin paths (/admin/**) - middleware accessControl
 * - Protected plugin pages - custom rules accessControl
 * - Public pages - always accessible
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
// Public Pages - Always Accessible
// ========================================================================
test.describe('Public Pages - No Auth Required', () => {
  test('homepage should be accessible without login', async ({ page }) => {
    const response = await page.goto('/');
    expect(response.status()).toBe(200);
  });

  test('login page should be accessible without login', async ({ page }) => {
    const response = await page.goto(URLS.loginPage);
    expect(response.status()).toBe(200);
    await expect(page.locator('form#loginForm')).toBeVisible();
  });

  test('logged API should be accessible without login (returns not-logged status)', async ({ page }) => {
    const response = await page.request.get(URLS.loggedApi);
    expect(response.status()).toBe(200);
  });
});

// ========================================================================
// Reserved Paths - adminUsers Middleware (/reserved, /private, /lib)
// ========================================================================
test.describe('Reserved Paths - Require Authentication', () => {
  test('/reserved/ should return 401 when not authenticated', async ({ page }) => {
    const response = await page.request.get(URLS.reservedPage, {
      maxRedirects: 0
    });
    // Middleware returns 401 with JSON body
    expect(response.status()).toBe(401);
  });

  test('/private/ should return 401 when not authenticated', async ({ page }) => {
    const response = await page.request.get(URLS.privatePage, {
      maxRedirects: 0
    });
    expect(response.status()).toBe(401);
  });

  test('/lib/ should return 401 when not authenticated', async ({ page }) => {
    const response = await page.request.get(URLS.libPage, {
      maxRedirects: 0
    });
    expect(response.status()).toBe(401);
  });

  test('reserved path should return access denied message', async ({ page }) => {
    const response = await page.request.get(URLS.reservedPage, {
      maxRedirects: 0
    });
    const body = await response.json();
    expect(body.message).toContain('Accesso negato');
  });
});

// ========================================================================
// Admin Pages - accessControl Middleware
// ========================================================================
test.describe('Admin Pages - Require Admin Role', () => {
  test('admin dashboard should redirect unauthenticated users', async ({ page }) => {
    const response = await page.request.get(URLS.adminDashboard, {
      maxRedirects: 0
    });
    // accessControl middleware redirects (302) to login page
    expect([302, 301]).toContain(response.status());
  });

  test('admin dashboard should redirect to login page', async ({ page }) => {
    // Follow redirects to check final destination
    await page.goto(URLS.adminDashboard);
    const currentUrl = page.url();
    // Should be redirected to login page or access-denied
    expect(
      currentUrl.includes('login.ejs') || currentUrl.includes('access-denied')
    ).toBe(true);
  });

  test('admin sub-pages should be protected', async ({ page }) => {
    const response = await page.request.get('/admin/systemSettings/index.ejs', {
      maxRedirects: 0
    });
    expect([302, 301]).toContain(response.status());
  });
});

// ========================================================================
// Admin API Endpoints - Require Admin Role
// ========================================================================
test.describe('Admin API Endpoints - Require Admin Role', () => {
  test('userList API should reject unauthenticated requests', async ({ page }) => {
    const response = await page.request.get(URLS.userListApi, {
      maxRedirects: 0
    });
    // The route handler checks auth, or accessControl middleware handles it
    // Expected: 401, 302 redirect, or 403
    expect([401, 302, 403]).toContain(response.status());
  });

  test('roleList API should reject unauthenticated requests', async ({ page }) => {
    const response = await page.request.get(URLS.roleListApi, {
      maxRedirects: 0
    });
    expect([401, 302, 403]).toContain(response.status());
  });
});

// ========================================================================
// Protected Plugin Pages - Custom Rules
// ========================================================================
test.describe('Protected Plugin Pages', () => {
  test('user profile page should redirect unauthenticated users', async ({ page }) => {
    const response = await page.request.get(URLS.userProfile, {
      maxRedirects: 0
    });
    // Custom rule: requiresAuth: true, allowedRoles: []
    expect([302, 301]).toContain(response.status());
  });
});

// ========================================================================
// Authenticated Access - Admin User
// ========================================================================
test.describe('Authenticated Access - Admin User', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.username, TEST_PASSWORD);
  });

  test('admin user should access admin dashboard', async ({ page }) => {
    const response = await page.goto(URLS.adminDashboard);
    // Admin user (role 1) should access admin pages
    expect(response.status()).toBe(200);
  });

  test('admin user should access user list API', async ({ page }) => {
    const response = await page.request.get(URLS.userListApi);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('admin user should access role list API', async ({ page }) => {
    const response = await page.request.get(URLS.roleListApi);
    expect(response.status()).toBe(200);
  });

  test('admin user should access user profile page', async ({ page }) => {
    const response = await page.goto(URLS.userProfile);
    expect(response.status()).toBe(200);
  });
});

// ========================================================================
// Authenticated Access - Root User
// ========================================================================
test.describe('Authenticated Access - Root User', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.root.username, TEST_PASSWORD);
  });

  test('root user should access admin dashboard', async ({ page }) => {
    const response = await page.goto(URLS.adminDashboard);
    expect(response.status()).toBe(200);
  });

  test('root user should access user list API', async ({ page }) => {
    const response = await page.request.get(URLS.userListApi);
    expect(response.status()).toBe(200);
  });
});

// ========================================================================
// Authenticated Access - Editor User (Limited)
// ========================================================================
test.describe('Authenticated Access - Editor User', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.editor.username, TEST_PASSWORD);
  });

  test('editor should access public homepage', async ({ page }) => {
    const response = await page.goto('/');
    expect(response.status()).toBe(200);
  });

  test('editor should access user profile page', async ({ page }) => {
    const response = await page.goto(URLS.userProfile);
    expect(response.status()).toBe(200);
  });

  test('editor should be redirected from admin dashboard (wrong role)', async ({ page }) => {
    await page.goto(URLS.adminDashboard);
    const currentUrl = page.url();
    // Editor (role 2) should NOT access admin pages (requires role 0 or 1)
    expect(currentUrl).toContain('access-denied');
  });
});

// ========================================================================
// Authenticated Access - SelfEditor User (Most Limited)
// ========================================================================
test.describe('Authenticated Access - SelfEditor User', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.selfEditor.username, TEST_PASSWORD);
  });

  test('selfEditor should access public homepage', async ({ page }) => {
    const response = await page.goto('/');
    expect(response.status()).toBe(200);
  });

  test('selfEditor should be redirected from admin dashboard', async ({ page }) => {
    await page.goto(URLS.adminDashboard);
    const currentUrl = page.url();
    expect(currentUrl).toContain('access-denied');
  });

  test('selfEditor should access user profile page (any authenticated)', async ({ page }) => {
    const response = await page.goto(URLS.userProfile);
    expect(response.status()).toBe(200);
  });
});
