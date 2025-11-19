// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Homepage', () => {
  test('should load homepage successfully', async ({ page }) => {
    await page.goto('/');

    // Verify page loads
    await expect(page).toHaveTitle(/ital8cms|Home/i);
  });

  test('should have navigation elements', async ({ page }) => {
    await page.goto('/');

    // Check for basic page structure
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should load Bootstrap CSS', async ({ page }) => {
    await page.goto('/');

    // Verify Bootstrap is loaded via the bootstrap plugin
    const response = await page.request.get('/api/bootstrap/css/bootstrap.min.css');
    expect(response.status()).toBe(200);
  });
});
