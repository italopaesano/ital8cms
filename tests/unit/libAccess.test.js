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

// ─────────────────────────────────────────────────────────────────────────────
// REVIEW.md → B4 (chiavi di prototipo) e C3 (enumerazione per timing)
// ─────────────────────────────────────────────────────────────────────────────

describe('B4 — le chiavi di Object.prototype non fanno più 500', () => {
  async function autenticateCon(users) {
    jest.resetModules();
    jest.mock('../../core/loadJson5', () => jest.fn());
    const loadJson5 = require('../../core/loadJson5');
    loadJson5.mockReturnValue({ users });
    return require('../../plugins/adminUsers/lib/libAccess').autenticate;
  }

  // Il difetto: `users[username]` su un oggetto normale restituisce anche i
  // membri del prototipo, che sono TRUTHY. Con `constructor` come username il
  // controllo di esistenza passava, `.hashPassword` era `undefined`, e
  // `bcrypt.compare(password, undefined)` RIGETTAVA — un 500 su un endpoint
  // pubblico e non autenticato, provocabile con una parola.
  test.each(['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty'])(
    'username "%s" → false, senza lanciare',
    async (username) => {
      const autenticate = await autenticateCon({ mario: { hashPassword: 'x', email: 'm@x' } });

      await expect(autenticate(username, 'qualsiasi')).resolves.toBe(false);
    });

  test('un utente vero continua a funzionare', async () => {
    const hash = await bcrypt.hash('giusta', 10);
    const autenticate = await autenticateCon({ mario: { hashPassword: hash, email: 'm@x' } });

    await expect(autenticate('mario', 'giusta')).resolves.toBe(true);
    await expect(autenticate('mario', 'sbagliata')).resolves.toBe(false);
  });

  test('un record senza hashPassword non arriva a bcrypt con undefined', async () => {
    // Era l'altra via per lo stesso 500: un utente presente ma malformato.
    const autenticate = await autenticateCon({ rotto: { email: 'r@x' } });

    await expect(autenticate('rotto', 'qualsiasi')).resolves.toBe(false);
  });

  test('username vuoto o assente → false', async () => {
    const autenticate = await autenticateCon({ mario: { hashPassword: 'x' } });

    await expect(autenticate('', 'x')).resolves.toBe(false);
    await expect(autenticate(undefined, 'x')).resolves.toBe(false);
    await expect(autenticate('mario', '')).resolves.toBe(false);
  });
});

describe('C3 — il ramo « utente inesistente » costa come gli altri', () => {
  // Il difetto: bcrypt girava SOLO quando lo username esisteva, quindi la
  // risposta per uno username inesistente arrivava in pochi millisecondi contro
  // i ~100 di uno valido. La differenza è misurabile da fuori, e dice a un
  // estraneo QUALI username esistono.
  //
  // Si verifica il MECCANISMO (bcrypt viene invocato comunque) e non il tempo:
  // un'asserzione sui millisecondi sarebbe instabile su una macchina carica, e
  // un presidio instabile viene disattivato.
  async function conSpia(users) {
    jest.resetModules();
    jest.mock('../../core/loadJson5', () => jest.fn());
    const loadJson5 = require('../../core/loadJson5');
    loadJson5.mockReturnValue({ users });

    const bcryptModule = require('bcryptjs');
    const spia = jest.spyOn(bcryptModule, 'compare');
    const autenticate = require('../../plugins/adminUsers/lib/libAccess').autenticate;
    return { autenticate, spia };
  }

  afterEach(() => jest.restoreAllMocks());

  test('bcrypt.compare viene invocato anche per un utente che non esiste', async () => {
    const { autenticate, spia } = await conSpia({ mario: { hashPassword: 'x' } });

    await autenticate('nessuno-con-questo-nome', 'password');

    expect(spia).toHaveBeenCalledTimes(1);
  });

  test('e anche per una chiave di prototipo', async () => {
    const { autenticate, spia } = await conSpia({ mario: { hashPassword: 'x' } });

    await autenticate('constructor', 'password');

    expect(spia).toHaveBeenCalledTimes(1);
  });

  test('l\'hash equalizzatore è un hash bcrypt valido, altrimenti il costo non è lo stesso', async () => {
    // Un hash malformato farebbe rigettare `compare` subito: stesso numero di
    // chiamate, tempo diverso, oracolo riaperto.
    const { autenticate, spia } = await conSpia({});

    await autenticate('nessuno', 'password');

    const [, hashUsato] = spia.mock.calls[0];
    expect(hashUsato).toMatch(/^\$2[aby]\$\d{2}\$/);
    await expect(bcrypt.compare('qualsiasi', hashUsato)).resolves.toBe(false);
  });
});

