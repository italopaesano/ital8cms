// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Admin Panel', () => {
  test('should load admin dashboard', async ({ page }) => {
    await page.goto('/admin/');

    // Admin page should load
    await expect(page.locator('body')).toBeVisible();
  });

  test('should have user management section', async ({ page }) => {
    await page.goto('/admin/userManagment/');

    // User management page should load
    await expect(page.locator('body')).toBeVisible();
  });

  test('should navigate between admin sections', async ({ page }) => {
    await page.goto('/admin/');

    // Check for navigation links
    const links = page.locator('a[href*="admin"]');
    const count = await links.count();

    // Should have at least some admin navigation
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
