/**
 * Unit Tests per la materializzazione dei config in fase di installazione
 * (plugins/admin/pluginsInstall.js e themesInstall.js).
 *
 * Copre la canonizzazione del `.default` come sola fonte di verità di un
 * pacchetto distribuibile (docs/decisions/config-lifecycle.it.md): il repo
 * committa i `x.default.json5`, l'installazione genera i `x.json5` vivi.
 *
 * I due moduli espongono una `materializeConfigFile` volutamente identica
 * (cambia solo il nome del descrittore): i test sono paralleli, così una futura
 * divergenza fra plugin e temi viene rilevata subito.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const loadJson5 = require(path.join(PROJECT_ROOT, 'core', 'loadJson5'));

const {
  _materializeConfigFile: materializePluginConfigFile,
  _validateClonedPlugin: validateClonedPlugin,
  _finalizePluginConfig: finalizePluginConfig,
} = require(path.join(PROJECT_ROOT, 'plugins', 'admin', 'pluginsInstall'));

const {
  _materializeConfigFile: materializeThemeConfigFile,
  _validateClonedTheme: validateClonedTheme,
  _finalizeThemeConfig: finalizeThemeConfig,
} = require(path.join(PROJECT_ROOT, 'plugins', 'admin', 'themesInstall'));

const JSON5_HEADER = '// This file follows the JSON5 standard - comments and trailing commas are supported';

let workDir;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-install-'));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

function write(relPath, content) {
  const full = path.join(workDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

// Repo di plugin conforme: solo il `.default`, nessun vivo.
function scaffoldPluginRepo({ extraConfigDefault = true } = {}) {
  write('main.js', 'module.exports = { async loadPlugin() {}, getRouteArray() { return []; } };\n');
  write('pluginDescription.json5', `${JSON5_HEADER}\n{ name: "demoPlugin", version: "0.0.1", description: "d", author: "a", email: "a@b.c", license: "ISC" }\n`);
  write('pluginConfig.default.json5', [
    JSON5_HEADER,
    '{',
    '  schemaVersion: 1,  // commento sulla versione di struttura',
    '  active: 1,',
    '  weight: 100,',
    '  dependency: {},',
    '  nodeModuleDependency: {},',
    '  custom: {',
    '    // commento su una impostazione',
    '    greeting: "ciao",',
    '  },',
    '}',
    '',
  ].join('\n'));
  if (extraConfigDefault) {
    write('demoStore.default.json5', `${JSON5_HEADER}\n{ schemaVersion: 1, entries: [] }\n`);
  }
}

// Repo di tema conforme: solo il `.default`, nessun vivo.
function scaffoldThemeRepo({ configBody } = {}) {
  write('views/head.ejs', '<head></head>\n');
  write('views/footer.ejs', '<footer></footer>\n');
  write('themeDescription.json5', `${JSON5_HEADER}\n{ name: "demoTheme", version: "0.0.1", description: "d", author: "a", email: "a@b.c", license: "ISC" }\n`);
  write('themeConfig.default.json5', configBody || [
    JSON5_HEADER,
    '{',
    '  schemaVersion: 1,  // commento sulla versione di struttura',
    '  isAdminTheme: false,',
    '  dependency: {},',
    '  nodeModuleDependency: {},',
    '}',
    '',
  ].join('\n'));
}

describe('pluginsInstall — materializeConfigFile', () => {
  test('genera il vivo dal .default e preserva i commenti del sidecar', async () => {
    scaffoldPluginRepo({ extraConfigDefault: false });

    const res = await materializePluginConfigFile(workDir, 'pluginConfig');

    expect(res.ok).toBe(true);
    expect(res.value.created).toContain('pluginConfig.json5');
    expect(res.value.warnings).toEqual([]);

    const live = fs.readFileSync(path.join(workDir, 'pluginConfig.json5'), 'utf8');
    expect(live).toContain('// commento sulla versione di struttura');
    expect(live).toContain('// commento su una impostazione');
  });

  test('materializza anche i config secondari del pacchetto, non solo il descrittore', async () => {
    scaffoldPluginRepo();

    const res = await materializePluginConfigFile(workDir, 'pluginConfig');

    expect(res.ok).toBe(true);
    expect(res.value.created.sort()).toEqual(['demoStore.json5', 'pluginConfig.json5']);
    expect(fs.existsSync(path.join(workDir, 'demoStore.json5'))).toBe(true);
  });

  test('rifiuta il pacchetto privo di pluginConfig.default.json5 (anche se pubblica il vivo)', async () => {
    scaffoldPluginRepo({ extraConfigDefault: false });
    fs.renameSync(
      path.join(workDir, 'pluginConfig.default.json5'),
      path.join(workDir, 'pluginConfig.json5'),
    );

    const res = await materializePluginConfigFile(workDir, 'pluginConfig');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('pluginConfig.default.json5');
  });

  test('scarta i config vivi committati nel repo e li rigenera dal .default', async () => {
    scaffoldPluginRepo({ extraConfigDefault: false });
    write('pluginConfig.json5', `${JSON5_HEADER}\n{ schemaVersion: 1, active: 1, weight: 1, dependency: {}, nodeModuleDependency: {}, custom: { greeting: "MANOMESSO" } }\n`);

    const res = await materializePluginConfigFile(workDir, 'pluginConfig');

    expect(res.ok).toBe(true);
    expect(res.value.warnings).toHaveLength(1);
    expect(res.value.warnings[0]).toContain('pluginConfig.json5');
    // Il default ha vinto: i valori pubblicati nel vivo non sopravvivono.
    expect(loadJson5(path.join(workDir, 'pluginConfig.json5')).custom.greeting).toBe('ciao');
  });

  test('non tocca i file .json5 privi di sidecar .default', async () => {
    scaffoldPluginRepo({ extraConfigDefault: false });
    write('contenutoIniziale.json5', `${JSON5_HEADER}\n{ pagine: ["home"] }\n`);

    const res = await materializePluginConfigFile(workDir, 'pluginConfig');

    expect(res.ok).toBe(true);
    expect(loadJson5(path.join(workDir, 'contenutoIniziale.json5')).pagine).toEqual(['home']);
  });
});

describe('pluginsInstall — validateClonedPlugin (standard .default)', () => {
  test('accetta il repo conforme dopo la materializzazione', async () => {
    scaffoldPluginRepo({ extraConfigDefault: false });
    await materializePluginConfigFile(workDir, 'pluginConfig');

    const res = validateClonedPlugin(workDir, 'demoPlugin');

    expect(res.ok).toBe(true);
    expect(res.value.warnings).toEqual([]);
  });

  test('segnala come mancante il .default, non il vivo', () => {
    scaffoldPluginRepo({ extraConfigDefault: false });
    fs.rmSync(path.join(workDir, 'pluginConfig.default.json5'));

    const res = validateClonedPlugin(workDir, 'demoPlugin');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('pluginConfig.default.json5');
  });

  test('avvisa se il .default dichiara isInstalled (stato runtime fuori posto)', async () => {
    scaffoldPluginRepo({ extraConfigDefault: false });
    write('pluginConfig.default.json5', `${JSON5_HEADER}\n{ schemaVersion: 1, active: 1, isInstalled: 1, weight: 100, dependency: {}, nodeModuleDependency: {}, custom: {} }\n`);
    await materializePluginConfigFile(workDir, 'pluginConfig');

    const res = validateClonedPlugin(workDir, 'demoPlugin');

    expect(res.ok).toBe(true);
    expect(res.value.warnings.join(' ')).toContain('isInstalled');
  });
});

describe('pluginsInstall — finalizePluginConfig', () => {
  test('scrive active/isInstalled preservando commenti e formattazione del vivo', async () => {
    scaffoldPluginRepo({ extraConfigDefault: false });
    await materializePluginConfigFile(workDir, 'pluginConfig');
    const configPath = path.join(workDir, 'pluginConfig.json5');

    const updated = await finalizePluginConfig({ configPath, wantActive: true, hasNpmDeps: false });

    expect(updated.active).toBe(1);
    expect(updated.isInstalled).toBe(1);
    const raw = fs.readFileSync(configPath, 'utf8');
    expect(raw).toContain('// commento sulla versione di struttura');
    expect(raw).toContain('// commento su una impostazione');
  });

  test('con dipendenze npm il plugin resta disattivato ma installato', async () => {
    scaffoldPluginRepo({ extraConfigDefault: false });
    await materializePluginConfigFile(workDir, 'pluginConfig');

    const updated = await finalizePluginConfig({
      configPath: path.join(workDir, 'pluginConfig.json5'),
      wantActive: true,
      hasNpmDeps: true,
    });

    expect(updated.active).toBe(0);
    expect(updated.isInstalled).toBe(1);
  });
});

describe('themesInstall — materializeConfigFile (gemello dei plugin)', () => {
  test('genera il vivo dal .default e preserva i commenti del sidecar', async () => {
    scaffoldThemeRepo();

    const res = await materializeThemeConfigFile(workDir, 'themeConfig');

    expect(res.ok).toBe(true);
    expect(res.value.created).toContain('themeConfig.json5');
    expect(fs.readFileSync(path.join(workDir, 'themeConfig.json5'), 'utf8'))
      .toContain('// commento sulla versione di struttura');
  });

  test('rifiuta il pacchetto privo di themeConfig.default.json5', async () => {
    scaffoldThemeRepo();
    fs.renameSync(
      path.join(workDir, 'themeConfig.default.json5'),
      path.join(workDir, 'themeConfig.json5'),
    );

    const res = await materializeThemeConfigFile(workDir, 'themeConfig');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('themeConfig.default.json5');
  });
});

describe('themesInstall — validate + finalize (standard .default)', () => {
  test('accetta il repo conforme e forza isInstalled a 0 preservando i commenti', async () => {
    scaffoldThemeRepo();
    await materializeThemeConfigFile(workDir, 'themeConfig');

    const valRes = validateClonedTheme(workDir, 'demoTheme');
    expect(valRes.ok).toBe(true);
    expect(valRes.value.isAdminTheme).toBe(false);
    expect(valRes.value.warnings).toEqual([]);

    const finalConfig = await finalizeThemeConfig({
      configPath: valRes.value.configPath,
      config: valRes.value.config,
    });

    expect(finalConfig.isInstalled).toBe(0);
    expect(fs.readFileSync(path.join(workDir, 'themeConfig.json5'), 'utf8'))
      .toContain('// commento sulla versione di struttura');
  });

  test('il campo legacy "active" nel .default produce un warning e viene rimosso dal vivo', async () => {
    scaffoldThemeRepo({
      configBody: `${JSON5_HEADER}\n{ schemaVersion: 1, active: 1, isAdminTheme: false, dependency: {}, nodeModuleDependency: {} }\n`,
    });
    await materializeThemeConfigFile(workDir, 'themeConfig');

    const valRes = validateClonedTheme(workDir, 'demoTheme');
    expect(valRes.ok).toBe(true);
    expect(valRes.value.warnings.join(' ')).toContain('active');

    const finalConfig = await finalizeThemeConfig({
      configPath: valRes.value.configPath,
      config: valRes.value.config,
    });

    expect(finalConfig.active).toBeUndefined();
    expect(finalConfig.isInstalled).toBe(0);
    expect(loadJson5(path.join(workDir, 'themeConfig.json5')).active).toBeUndefined();
  });
});
