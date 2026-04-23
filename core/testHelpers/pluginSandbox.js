/**
 * pluginSandbox.js
 *
 * Crea una directory temporanea isolata che riproduce la struttura di un plugin
 * ital8cms. Usare nei test che devono scrivere file (config, backup, dati) senza
 * contaminare la cartella `plugins/` reale del progetto.
 *
 * Uso tipico:
 *   const sandbox = createPluginSandbox('myPlugin');
 *   try {
 *     sandbox.writeJson5('custom.json5', { foo: 'bar' });
 *     // ... test ...
 *   } finally {
 *     sandbox.cleanup();
 *   }
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_PLUGIN_CONFIG = {
  active: 1,
  isInstalled: 1,
  weight: 0,
  dependency: {},
  nodeModuleDependency: {},
  custom: {}
};

function defaultPluginDescription(pluginName) {
  return {
    name: pluginName,
    version: '1.0.0',
    description: `Sandbox plugin ${pluginName}`,
    author: 'test',
    email: 'test@test.local',
    license: 'ISC'
  };
}

function writeJson5File(filePath, obj) {
  const content =
    '// This file follows the JSON5 standard - comments and trailing commas are supported\n' +
    JSON.stringify(obj, null, 2);
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Crea un sandbox isolato per un plugin.
 *
 * @param {string} pluginName - Nome del plugin (usato per creare il path e i default)
 * @param {Object} [options={}]
 * @param {Object} [options.pluginConfig] Override parziale di pluginConfig.json5
 * @param {Object} [options.pluginDescription] Override parziale di pluginDescription.json5
 * @param {boolean} [options.withPluginPages=false] Se true, crea la cartella webPages/
 * @param {string[]} [options.withAdminSections] Array di sezione ID: crea adminWebSections/{id}/
 * @param {boolean} [options.withTests=false] Se true, crea tests/unit/ e tests/fixtures/
 * @returns {Object} API del sandbox
 */
function createPluginSandbox(pluginName, options = {}) {
  if (!pluginName || typeof pluginName !== 'string') {
    throw new Error('createPluginSandbox: pluginName must be a non-empty string');
  }

  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ital8-sandbox-${pluginName}-`));
  const pluginPath = path.join(sandboxRoot, pluginName);
  fs.mkdirSync(pluginPath, { recursive: true });

  const pluginConfig = { ...DEFAULT_PLUGIN_CONFIG, ...(options.pluginConfig || {}) };
  writeJson5File(path.join(pluginPath, 'pluginConfig.json5'), pluginConfig);

  const pluginDescription = {
    ...defaultPluginDescription(pluginName),
    ...(options.pluginDescription || {})
  };
  writeJson5File(path.join(pluginPath, 'pluginDescription.json5'), pluginDescription);

  if (options.withPluginPages) {
    fs.mkdirSync(path.join(pluginPath, 'webPages'), { recursive: true });
  }

  if (options.withAdminSections && Array.isArray(options.withAdminSections)) {
    for (const sectionId of options.withAdminSections) {
      fs.mkdirSync(path.join(pluginPath, 'adminWebSections', sectionId), { recursive: true });
    }
  }

  if (options.withTests) {
    fs.mkdirSync(path.join(pluginPath, 'tests', 'unit'), { recursive: true });
    fs.mkdirSync(path.join(pluginPath, 'tests', 'fixtures'), { recursive: true });
  }

  return {
    root: sandboxRoot,
    path: pluginPath,
    pluginName,
    pluginConfigPath: path.join(pluginPath, 'pluginConfig.json5'),
    pluginDescriptionPath: path.join(pluginPath, 'pluginDescription.json5'),

    /**
     * Scrive un file arbitrario dentro il sandbox del plugin.
     * @param {string} relativePath - Path relativo alla root del plugin
     * @param {string|Buffer} content
     * @returns {string} Path assoluto del file scritto
     */
    writeFile(relativePath, content) {
      const fullPath = path.join(pluginPath, relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, typeof content === 'string' ? 'utf8' : undefined);
      return fullPath;
    },

    /**
     * Scrive un file JSON5 dentro il sandbox (con header commento standard).
     * @param {string} relativePath
     * @param {*} obj
     * @returns {string} Path assoluto
     */
    writeJson5(relativePath, obj) {
      const fullPath = path.join(pluginPath, relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      writeJson5File(fullPath, obj);
      return fullPath;
    },

    /**
     * Legge un file dentro il sandbox.
     * @param {string} relativePath
     * @returns {string}
     */
    readFile(relativePath) {
      return fs.readFileSync(path.join(pluginPath, relativePath), 'utf8');
    },

    /**
     * Verifica esistenza di un file/directory dentro il sandbox.
     * @param {string} relativePath
     * @returns {boolean}
     */
    exists(relativePath) {
      return fs.existsSync(path.join(pluginPath, relativePath));
    },

    /**
     * Rimuove ricorsivamente tutto il sandbox. Da chiamare in afterEach/afterAll.
     */
    cleanup() {
      if (fs.existsSync(sandboxRoot)) {
        fs.rmSync(sandboxRoot, { recursive: true, force: true });
      }
    }
  };
}

module.exports = { createPluginSandbox };
