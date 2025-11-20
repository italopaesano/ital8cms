/**
 * Jest Setup File
 * Configurazione globale per tutti i test
 */

// Silenzio i log durante i test (opzionale)
// process.env.LOG_LEVEL = 'ERROR';

// Timeout esteso per test di integrazione
jest.setTimeout(10000);

// Helper globale per test
global.testHelpers = {
  // Aspetta un certo tempo
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  // Crea un plugin di test temporaneo
  createMockPlugin: (name, config = {}) => ({
    name,
    config: {
      active: 1,
      isInstalled: 1,
      weight: 0,
      dependency: {},
      nodeModuleDependency: {},
      version: '1.0.0',
      ...config
    }
  })
};

// Cleanup dopo tutti i test
afterAll(async () => {
  // Cleanup risorse se necessario
});
