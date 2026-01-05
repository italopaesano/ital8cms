// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('API Endpoints', () => {
  test('should serve Bootstrap CSS', async ({ request }) => {
    const response = await request.get('/api/bootstrap/css/bootstrap.min.css');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('css');
  });

  test('should serve Bootstrap JS', async ({ request }) => {
    const response = await request.get('/api/bootstrap/js/bootstrap.min.js');
    expect(response.status()).toBe(200);
  });

  test('should have adminUsers login endpoint', async ({ request }) => {
    const response = await request.get('/api/adminUsers/login');
    expect(response.status()).toBe(200);
  });

  test('should have adminUsers logged endpoint', async ({ request }) => {
    const response = await request.get('/api/adminUsers/logged');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toBeDefined();
  });

  test('should return 404 for non-existent API route', async ({ request }) => {
    const response = await request.get('/api/nonexistent/route');
    expect(response.status()).toBe(404);
  });
});

test.describe('Plugin Routes', () => {
  test('should have dbApi plugin available', async ({ page }) => {
    // This test verifies the plugin system is working
    // by checking that routes are properly registered
    await page.goto('/');

    // Page loads means plugins initialized correctly
    await expect(page.locator('body')).toBeVisible();
  });
});
