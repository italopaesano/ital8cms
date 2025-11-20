# Test Suite - ital8cms

## Panoramica

La test suite di ital8cms utilizza due framework complementari:

- **Jest** - Unit e integration tests (logica backend)
- **Playwright** - E2E tests (browser e API)

## Struttura Cartelle

```
tests/
├── setup.js                    # Configurazione Jest
├── unit/                       # Unit tests
│   ├── logger.test.js          # Test logger
│   └── pluginSys.test.js       # Test funzioni plugin system
├── integration/                # Integration tests
│   └── pluginLoading.test.js   # Test caricamento plugin
├── e2e/                        # Playwright E2E tests
│   ├── homepage.spec.js        # Test homepage
│   ├── admin.spec.js           # Test admin panel
│   ├── auth.spec.js            # Test autenticazione
│   └── api.spec.js             # Test API endpoints
└── fixtures/                   # Dati di test
```

## Comandi Disponibili

### Jest (Unit + Integration)

```bash
# Esegui tutti i test Jest
npm test

# Watch mode (ri-esegue su modifiche)
npm run test:watch

# Con coverage report
npm run test:coverage

# Solo unit tests
npm run test:unit

# Solo integration tests
npm run test:integration
```

### Playwright (E2E)

```bash
# Esegui tutti i test E2E
npm run test:e2e

# Con UI interattiva
npm run test:e2e:ui

# Con browser visibile
npm run test:e2e:headed

# Debug mode
npm run test:e2e:debug

# Mostra ultimo report
npm run test:e2e:report
```

### Suite Completa

```bash
# Jest + Playwright
npm run test:all
```

## Test Coverage

### Unit Tests (logger.test.js)

| Test | Descrizione |
|------|-------------|
| Log Levels | Verifica INFO, ERROR, DEBUG, WARN |
| Log Filtering | Filtraggio per livello |
| Utility Functions | getLevel, isLevelEnabled |
| Output Format | Timestamp, prefissi |
| Error Handling | Stack trace, dati extra |

### Unit Tests (pluginSys.test.js)

| Test | Descrizione |
|------|-------------|
| Dependency Checking | Verifica dipendenze soddisfatte |
| Circular Detection | Rileva cicli A->B->A, A->B->C->A |
| Semver Checking | Range ^, ~, versione esatta |
| Weight Sorting | Ordinamento per priorità |

### Integration Tests (pluginLoading.test.js)

| Test | Descrizione |
|------|-------------|
| Structure Validation | main.js, config, description presenti |
| Config Validation | Versioni semver, weight valido |
| Module Loading | Plugin caricabili senza errori |
| Dependencies | Moduli npm installati, no cicli |

### E2E Tests

| Test | Descrizione |
|------|-------------|
| Homepage | Caricamento pagina principale |
| Admin | Dashboard admin, navigazione |
| Auth | Login/logout flow |
| API | Endpoint Bootstrap, ecc. |

## Scrivere Nuovi Test

### Unit Test (Jest)

```javascript
// tests/unit/myModule.test.js
describe('My Module', () => {
  test('funzione fa qualcosa', () => {
    const result = myFunction();
    expect(result).toBe(expected);
  });
});
```

### Integration Test (Jest)

```javascript
// tests/integration/myFeature.test.js
describe('My Feature Integration', () => {
  beforeAll(() => {
    // Setup
  });

  test('integrazione funziona', () => {
    // Test
  });
});
```

### E2E Test (Playwright)

```javascript
// tests/e2e/myPage.spec.js
const { test, expect } = require('@playwright/test');

test.describe('My Page', () => {
  test('carica correttamente', async ({ page }) => {
    await page.goto('/my-page');
    await expect(page.locator('h1')).toContainText('Title');
  });
});
```

## Configurazione

### Jest (jest.config.js)

```javascript
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/e2e/'],
  setupFilesAfterEnv: ['./tests/setup.js'],
  verbose: true,
  testTimeout: 10000
};
```

### Playwright (playwright.config.js)

```javascript
module.exports = defineConfig({
  testDir: './tests/e2e',
  baseURL: 'http://localhost:3000',
  webServer: {
    command: 'node index.js',
    url: 'http://localhost:3000'
  }
});
```

## Best Practices

### 1. Naming Convention

- Unit tests: `*.test.js`
- E2E tests: `*.spec.js`

### 2. Organizzazione Test

```javascript
describe('Module Name', () => {
  describe('Feature', () => {
    test('caso specifico', () => {
      // Test
    });
  });
});
```

### 3. Setup e Teardown

```javascript
beforeAll(() => { /* setup globale */ });
afterAll(() => { /* cleanup globale */ });
beforeEach(() => { /* setup per test */ });
afterEach(() => { /* cleanup per test */ });
```

### 4. Asserzioni Chiare

```javascript
// Buono
expect(result).toHaveProperty('name');
expect(array).toContain('item');

// Evitare
expect(result.name !== undefined).toBe(true);
```

### 5. Test Isolati

Ogni test deve essere indipendente e non dipendere dall'ordine di esecuzione.

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm test
      - run: npx playwright install --with-deps
      - run: npm run test:e2e
```

## Troubleshooting

### Test Timeout

Aumenta timeout in jest.config.js o nel test specifico:
```javascript
test('long operation', () => {
  // test
}, 30000); // 30 secondi
```

### Playwright Non Trova Server

Verifica che il server parta correttamente:
```bash
node index.js
# In altro terminale
npm run test:e2e
```

### Jest Open Handles Warning

Dovuto a connessioni non chiuse (database, timer). Aggiungi cleanup:
```javascript
afterAll(async () => {
  await db.close();
});
```

## Metriche Attuali

- **Test Totali**: 42 (Jest) + 17 (Playwright)
- **Coverage Target**: 80%+
- **Tempo Esecuzione**: ~3s (Jest), ~30s (Playwright)

---

**Versione**: 1.0.0
**Data**: 2025-11-19
