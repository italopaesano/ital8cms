// @ts-check
const { test, expect } = require('@playwright/test');
const { TEST_PASSWORD, TEST_USERS, URLS } = require('./testConstants');

/**
 * E2E Tests: Authentication System
 *
 * Testa il flusso completo di autenticazione:
 * - Login con credenziali valide e invalide
 * - Session persistence
 * - Logout
 * - Status check (/logged)
 */

// Helper: login via form submission
async function loginAs(page, username, password) {
  await page.goto(URLS.loginPage);
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  // Wait for navigation after form submit
  await page.waitForLoadState('networkidle');
}

// ========================================================================
// Login Page
// ========================================================================
test.describe('Login Page', () => {
  test('should display login form with all required fields', async ({ page }) => {
    await page.goto(URLS.loginPage);

    // Check form elements exist
    await expect(page.locator('form#loginForm')).toBeVisible();
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // Hidden referrerTo field should exist
    await expect(page.locator('input[name="referrerTo"]')).toBeAttached();
  });

  test('should have correct form action pointing to login API', async ({ page }) => {
    await page.goto(URLS.loginPage);

    const formAction = await page.locator('form#loginForm').getAttribute('action');
    expect(formAction).toContain('/api/adminUsers/login');
  });
});

// ========================================================================
// Login with Valid Credentials
// ========================================================================
test.describe('Login - Valid Credentials', () => {
  test('should redirect after successful login as admin', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.username, TEST_PASSWORD);

    // After successful login, should be redirected (not on login page anymore)
    const currentUrl = page.url();
    expect(currentUrl).not.toContain('login.ejs');
    expect(currentUrl).not.toContain('error=invalid');
  });

  test('should set session cookie after login', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.username, TEST_PASSWORD);

    // Check that session cookie exists
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find(c => c.name.startsWith('koa:sess'));
    expect(sessionCookie).toBeDefined();
  });

  test('should show logged status after login', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.username, TEST_PASSWORD);

    // Check logged endpoint
    await page.goto(URLS.loggedApi);
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('complimenti sei loggato');
    expect(bodyText).toContain(TEST_USERS.admin.username);
  });

  test('should login successfully with root user', async ({ page }) => {
    await loginAs(page, TEST_USERS.root.username, TEST_PASSWORD);

    await page.goto(URLS.loggedApi);
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('complimenti sei loggato');
  });

  test('should login successfully with editor user', async ({ page }) => {
    await loginAs(page, TEST_USERS.editor.username, TEST_PASSWORD);

    await page.goto(URLS.loggedApi);
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('complimenti sei loggato');
  });
});

// ========================================================================
// Login with Invalid Credentials
// ========================================================================
test.describe('Login - Invalid Credentials', () => {
  test('should redirect back to login page with error on wrong password', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.username, 'WrongPassword123!');

    // Should be redirected back to login page with error
    const currentUrl = page.url();
    expect(currentUrl).toContain('login.ejs');
    expect(currentUrl).toContain('error=invalid');
  });

  test('should redirect back to login page with error on wrong username', async ({ page }) => {
    await loginAs(page, 'nonExistentUser', TEST_PASSWORD);

    const currentUrl = page.url();
    expect(currentUrl).toContain('login.ejs');
    expect(currentUrl).toContain('error=invalid');
  });

  test('should show error message on login page after failed attempt', async ({ page }) => {
    // Navigate directly to login page with error parameter
    await page.goto(URLS.loginPage + '?error=invalid');

    // The error div should become visible via JavaScript
    await page.waitForLoadState('domcontentloaded');
    const errorDiv = page.locator('#errorDiv');
    await expect(errorDiv).toBeVisible();
  });

  test('should NOT set authenticated session after failed login', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.username, 'WrongPassword123!');

    // Check logged endpoint - should show not logged
    await page.goto(URLS.loggedApi);
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('NON sei loggato');
  });
});

// ========================================================================
// Logout
// ========================================================================
test.describe('Logout', () => {
  test('should destroy session after logout', async ({ page }) => {
    // Login first
    await loginAs(page, TEST_USERS.admin.username, TEST_PASSWORD);

    // Verify logged in
    await page.goto(URLS.loggedApi);
    let bodyText = await page.textContent('body');
    expect(bodyText).toContain('complimenti sei loggato');

    // Logout via POST (using form from logout page)
    await page.goto(URLS.logoutPage);
    // Find and submit the logout form
    const logoutForm = page.locator('form[action*="logout"]');
    if (await logoutForm.count() > 0) {
      await logoutForm.locator('button[type="submit"], input[type="submit"]').first().click();
      await page.waitForLoadState('networkidle');
    } else {
      // If no form, use API directly
      await page.request.post(URLS.logoutApi, {
        form: { referrerTo: '/' }
      });
    }

    // Verify logged out
    await page.goto(URLS.loggedApi);
    bodyText = await page.textContent('body');
    expect(bodyText).toContain('NON sei loggato');
  });

  test('should display logout page', async ({ page }) => {
    await page.goto(URLS.logoutPage);
    await expect(page.locator('body')).toBeVisible();
  });
});

// ========================================================================
// Session Persistence
// ========================================================================
test.describe('Session Persistence', () => {
  test('should maintain session across page navigations', async ({ page }) => {
    // Login
    await loginAs(page, TEST_USERS.admin.username, TEST_PASSWORD);

    // Navigate to homepage
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to logged endpoint - session should still be active
    await page.goto(URLS.loggedApi);
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('complimenti sei loggato');
  });

  test('should NOT have session before login', async ({ page }) => {
    await page.goto(URLS.loggedApi);
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('NON sei loggato');
  });
});

// ========================================================================
// Login Status API
// ========================================================================
test.describe('Login Status API (/logged)', () => {
  test('should return text response when not logged in', async ({ page }) => {
    const response = await page.request.get(URLS.loggedApi);
    expect(response.status()).toBe(200);

    const text = await response.text();
    expect(text).toContain('NON sei loggato');
  });

  test('should return text response with user info when logged in', async ({ page }) => {
    // Login first
    await loginAs(page, TEST_USERS.root.username, TEST_PASSWORD);

    const response = await page.request.get(URLS.loggedApi);
    expect(response.status()).toBe(200);

    const text = await response.text();
    expect(text).toContain('complimenti sei loggato');
  });
});
