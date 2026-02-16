/**
 * Unit Tests: libAccess (Authentication)
 *
 * Testa la funzione di autenticazione del plugin adminUsers.
 * Usa mock per bcryptjs e loadJson5 per isolare la logica.
 */

const bcrypt = require('bcryptjs');
const path = require('path');

// Mock loadJson5 to return test user data
jest.mock('../../core/loadJson5', () => {
  return jest.fn();
});

const loadJson5 = require('../../core/loadJson5');

describe('libAccess - autenticate', () => {
  let autenticate;

  beforeEach(() => {
    // Clear module cache to re-load with fresh mocks
    jest.resetModules();

    // Re-mock loadJson5
    jest.mock('../../core/loadJson5', () => {
      return jest.fn();
    });
  });

  /**
   * Helper: loads libAccess with mock user data
   */
  async function loadLibAccessWithUsers(users) {
    const loadJson5 = require('../../core/loadJson5');
    loadJson5.mockReturnValue({ users });

    const libAccess = require('../../plugins/adminUsers/lib/libAccess');
    return libAccess.autenticate;
  }

  test('should authenticate with valid credentials', async () => {
    const hashedPassword = await bcrypt.hash('correctPassword', 10);
    const autenticate = await loadLibAccessWithUsers({
      testuser: {
        email: 'test@test.com',
        hashPassword: hashedPassword,
        roleIds: [1]
      }
    });

    const result = await autenticate('testuser', 'correctPassword');
    expect(result).toBe(true);
  });

  test('should reject invalid password', async () => {
    const hashedPassword = await bcrypt.hash('correctPassword', 10);
    const autenticate = await loadLibAccessWithUsers({
      testuser: {
        email: 'test@test.com',
        hashPassword: hashedPassword,
        roleIds: [1]
      }
    });

    const result = await autenticate('testuser', 'wrongPassword');
    expect(result).toBe(false);
  });

  test('should reject non-existent username', async () => {
    const autenticate = await loadLibAccessWithUsers({
      existinguser: {
        email: 'test@test.com',
        hashPassword: '$2b$10$fakehash',
        roleIds: [1]
      }
    });

    const result = await autenticate('nonexistent', 'anyPassword');
    expect(result).toBe(false);
  });

  test('should reject empty username', async () => {
    const autenticate = await loadLibAccessWithUsers({});

    const result = await autenticate('', 'anyPassword');
    expect(result).toBe(false);
  });

  test('should reject empty password', async () => {
    const hashedPassword = await bcrypt.hash('correctPassword', 10);
    const autenticate = await loadLibAccessWithUsers({
      testuser: {
        email: 'test@test.com',
        hashPassword: hashedPassword,
        roleIds: [1]
      }
    });

    const result = await autenticate('testuser', '');
    expect(result).toBe(false);
  });

  test('should reject null username', async () => {
    const autenticate = await loadLibAccessWithUsers({});

    const result = await autenticate(null, 'anyPassword');
    expect(result).toBe(false);
  });

  test('should reject null password', async () => {
    const autenticate = await loadLibAccessWithUsers({
      testuser: {
        email: 'test@test.com',
        hashPassword: '$2b$10$fakehash',
        roleIds: [1]
      }
    });

    const result = await autenticate('testuser', null);
    expect(result).toBe(false);
  });

  test('should reject undefined username', async () => {
    const autenticate = await loadLibAccessWithUsers({});

    const result = await autenticate(undefined, 'anyPassword');
    expect(result).toBe(false);
  });

  test('should handle bcrypt hash with correct salt rounds', async () => {
    // Create hash with 10 rounds (same as production)
    const hashedPassword = await bcrypt.hash('mySecurePass', 10);
    const autenticate = await loadLibAccessWithUsers({
      admin: {
        email: 'admin@test.com',
        hashPassword: hashedPassword,
        roleIds: [0]
      }
    });

    const result = await autenticate('admin', 'mySecurePass');
    expect(result).toBe(true);
  });
});
