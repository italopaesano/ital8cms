/**
 * Integration Tests per il sistema di caricamento plugin
 */

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');

describe('Plugin Loading Integration', () => {
  const pluginsDir = path.join(__dirname, '../../plugins');

  describe('Plugin Structure Validation', () => {
    let pluginDirs;

    beforeAll(() => {
      pluginDirs = fs.readdirSync(pluginsDir)
        .filter(file => fs.statSync(path.join(pluginsDir, file)).isDirectory())
        .filter(dir => !dir.startsWith('.'))
        .filter(dir => !dir.startsWith('OLD_')); // Esclude plugin deprecati OLD_*
    });

    test('tutti i plugin hanno main.js', () => {
      pluginDirs.forEach(pluginName => {
        const mainPath = path.join(pluginsDir, pluginName, 'main.js');
        expect(fs.existsSync(mainPath)).toBe(true);
      });
    });

    test('tutti i plugin hanno pluginConfig.json', () => {
      pluginDirs.forEach(pluginName => {
        const configPath = path.join(pluginsDir, pluginName, 'pluginConfig.json5');
        expect(fs.existsSync(configPath)).toBe(true);
      });
    });

    test('tutti i plugin hanno pluginDescription.json', () => {
      pluginDirs.forEach(pluginName => {
        const descPath = path.join(pluginsDir, pluginName, 'pluginDescription.json5');
        expect(fs.existsSync(descPath)).toBe(true);
      });
    });

    test('pluginConfig.json ha campi obbligatori', () => {
      pluginDirs.forEach(pluginName => {
        const configPath = path.join(pluginsDir, pluginName, 'pluginConfig.json5');
        const config = loadJson5(configPath);

        expect(config).toHaveProperty('active');
        expect(config).toHaveProperty('isInstalled');
        expect(config).toHaveProperty('weight');
        expect(config).toHaveProperty('dependency');
      });
    });

    test('pluginDescription.json ha campi obbligatori', () => {
      pluginDirs.forEach(pluginName => {
        const descPath = path.join(pluginsDir, pluginName, 'pluginDescription.json5');
        const desc = loadJson5(descPath);

        expect(desc).toHaveProperty('name');
        expect(desc).toHaveProperty('version');
      });
    });
  });

  describe('Plugin Config Validation', () => {
    test('versioni sono semver valide', () => {
      const semver = require('semver');
      const pluginDirs = fs.readdirSync(pluginsDir)
        .filter(file => fs.statSync(path.join(pluginsDir, file)).isDirectory())
        .filter(dir => !dir.startsWith('.'))
        .filter(dir => !dir.startsWith('OLD_'));

      pluginDirs.forEach(pluginName => {
        const descPath = path.join(pluginsDir, pluginName, 'pluginDescription.json5');
        const desc = loadJson5(descPath);

        if (desc.version) {
          expect(semver.valid(desc.version)).not.toBeNull();
        }
      });
    });

    test('dipendenze hanno formato semver valido', () => {
      const semver = require('semver');
      const pluginDirs = fs.readdirSync(pluginsDir)
        .filter(file => fs.statSync(path.join(pluginsDir, file)).isDirectory())
        .filter(dir => !dir.startsWith('.'))
        .filter(dir => !dir.startsWith('OLD_'));

      pluginDirs.forEach(pluginName => {
        const configPath = path.join(pluginsDir, pluginName, 'pluginConfig.json5');
        const config = loadJson5(configPath);

        if (config.dependency) {
          Object.entries(config.dependency).forEach(([dep, version]) => {
            expect(semver.validRange(version)).not.toBeNull();
          });
        }
      });
    });

    test('weight è un numero valido', () => {
      const pluginDirs = fs.readdirSync(pluginsDir)
        .filter(file => fs.statSync(path.join(pluginsDir, file)).isDirectory())
        .filter(dir => !dir.startsWith('.'))
        .filter(dir => !dir.startsWith('OLD_'));

      pluginDirs.forEach(pluginName => {
        const configPath = path.join(pluginsDir, pluginName, 'pluginConfig.json5');
        const config = loadJson5(configPath);

        expect(typeof config.weight).toBe('number');
        expect(config.weight).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Plugin Module Loading', () => {
    test('main.js è caricabile senza errori', () => {
      const pluginDirs = fs.readdirSync(pluginsDir)
        .filter(file => fs.statSync(path.join(pluginsDir, file)).isDirectory())
        .filter(dir => !dir.startsWith('.'))
        .filter(dir => !dir.startsWith('OLD_'));

      pluginDirs.forEach(pluginName => {
        const configPath = path.join(pluginsDir, pluginName, 'pluginConfig.json5');
        const config = loadJson5(configPath);

        // Salta plugin disattivati che potrebbero richiedere dipendenze non installate
        if (config.active === 0) {
          return;
        }

        const mainPath = path.join(pluginsDir, pluginName, 'main.js');

        expect(() => {
          require(mainPath);
        }).not.toThrow();
      });
    });

    test('plugin attivi esportano loadPlugin', () => {
      const pluginDirs = fs.readdirSync(pluginsDir)
        .filter(file => fs.statSync(path.join(pluginsDir, file)).isDirectory())
        .filter(dir => !dir.startsWith('.'))
        .filter(dir => !dir.startsWith('OLD_'));

      pluginDirs.forEach(pluginName => {
        const configPath = path.join(pluginsDir, pluginName, 'pluginConfig.json5');
        const config = loadJson5(configPath);

        if (config.active === 1) {
          const mainPath = path.join(pluginsDir, pluginName, 'main.js');
          const plugin = require(mainPath);

          expect(plugin).toHaveProperty('loadPlugin');
          expect(typeof plugin.loadPlugin).toBe('function');
        }
      });
    });
  });

  describe('Node Module Dependencies', () => {
    test('nodeModuleDependency moduli sono installati', () => {
      const pluginDirs = fs.readdirSync(pluginsDir)
        .filter(file => fs.statSync(path.join(pluginsDir, file)).isDirectory())
        .filter(dir => !dir.startsWith('.'))
        .filter(dir => !dir.startsWith('OLD_'));

      pluginDirs.forEach(pluginName => {
        const configPath = path.join(pluginsDir, pluginName, 'pluginConfig.json5');
        const config = loadJson5(configPath);

        if (config.nodeModuleDependency && config.active === 1) {
          Object.keys(config.nodeModuleDependency).forEach(moduleName => {
            // Verifica che il modulo esista in node_modules
            // Nota: Alcuni moduli (es. bootstrap-icons) non hanno entry point JS
            // quindi usiamo fs.existsSync invece di require.resolve()
            const modulePath = path.join(__dirname, '../../node_modules', moduleName);
            expect(fs.existsSync(modulePath)).toBe(true);
          });
        }
      });
    });
  });

  describe('Plugin Dependencies', () => {
    test('non ci sono dipendenze circolari', () => {
      const pluginDirs = fs.readdirSync(pluginsDir)
        .filter(file => fs.statSync(path.join(pluginsDir, file)).isDirectory())
        .filter(dir => !dir.startsWith('.'))
        .filter(dir => !dir.startsWith('OLD_'));

      // Costruisci grafo dipendenze
      const depGraph = new Map();

      pluginDirs.forEach(pluginName => {
        const configPath = path.join(pluginsDir, pluginName, 'pluginConfig.json5');
        const config = loadJson5(configPath);

        if (config.active === 1 && config.dependency) {
          depGraph.set(pluginName, new Map(Object.entries(config.dependency)));
        }
      });

      // DFS per cercare cicli
      function hasCycle() {
        const visited = new Set();
        const recursionStack = new Set();

        function dfs(node) {
          visited.add(node);
          recursionStack.add(node);

          const deps = depGraph.get(node);
          if (deps) {
            for (const [dep] of deps) {
              if (!depGraph.has(dep)) continue;
              if (!visited.has(dep) && dfs(dep)) return true;
              if (recursionStack.has(dep)) return true;
            }
          }

          recursionStack.delete(node);
          return false;
        }

        for (const [node] of depGraph) {
          if (!visited.has(node) && dfs(node)) return true;
        }

        return false;
      }

      expect(hasCycle()).toBe(false);
    });

    test('tutte le dipendenze esistono', () => {
      const pluginDirs = fs.readdirSync(pluginsDir)
        .filter(file => fs.statSync(path.join(pluginsDir, file)).isDirectory())
        .filter(dir => !dir.startsWith('.'))
        .filter(dir => !dir.startsWith('OLD_'));

      const allPlugins = new Set(pluginDirs);

      pluginDirs.forEach(pluginName => {
        const configPath = path.join(pluginsDir, pluginName, 'pluginConfig.json5');
        const config = loadJson5(configPath);

        if (config.active === 1 && config.dependency) {
          Object.keys(config.dependency).forEach(dep => {
            expect(allPlugins.has(dep)).toBe(true);
          });
        }
      });
    });
  });
});
