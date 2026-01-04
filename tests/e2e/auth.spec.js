// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Authentication', () => {
  test('should display login page', async ({ page }) => {
    await page.goto('/api/adminUsers/login');

    // Check for login form elements
    await expect(page.locator('form')).toBeVisible();
    await expect(page.locator('input[name="username"], input[type="text"]').first()).toBeVisible();
    await expect(page.locator('input[name="password"], input[type="password"]').first()).toBeVisible();
  });

  test('should reject invalid credentials', async ({ page }) => {
    await page.goto('/api/adminUsers/login');

    // Try to login with invalid credentials
    await page.fill('input[name="username"], input[type="text"]', 'invaliduser');
    await page.fill('input[name="password"], input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"], input[type="submit"]');

    // Should show error or stay on login page
    await expect(page).toHaveURL(/login|error/);
  });

  test('should check login status API', async ({ page }) => {
    // Check logged status when not authenticated
    const response = await page.request.get('/api/adminUsers/logged');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('logged');
  });

  test('should display logout page', async ({ page }) => {
    await page.goto('/api/adminUsers/logout');

    // Page should load without error
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Protected Routes', () => {
  test('should restrict access to protected routes when not logged in', async ({ page }) => {
    // Try to access a protected route
    const response = await page.request.get('/reserved/');

    // Should return 401 or redirect to login
    expect([401, 302, 403]).toContain(response.status());
  });
});
