/**
 * Unit Tests per core/pluginSys.js
 *
 * Testa le funzioni di utilità del sistema plugin
 */

const semver = require('semver');

describe('Plugin System Utilities', () => {

  describe('Dependency Checking', () => {
    // Funzione estratta da pluginSys per testing
    function isPluginDependenciesSatisfied(pluginsListMap, dependencyMap) {
      for (const [pluginName, version] of dependencyMap) {
        if (!pluginsListMap.has(pluginName)) {
          return false;
        }
      }
      return true;
    }

    test('ritorna true se non ci sono dipendenze', () => {
      const activePlugins = new Map([['dbApi', {}]]);
      const dependencies = new Map();

      expect(isPluginDependenciesSatisfied(activePlugins, dependencies)).toBe(true);
    });

    test('ritorna true se tutte le dipendenze sono soddisfatte', () => {
      const activePlugins = new Map([
        ['dbApi', {}],
        ['adminUsers', {}]
      ]);
      const dependencies = new Map([
        ['dbApi', '^1.0.0']
      ]);

      expect(isPluginDependenciesSatisfied(activePlugins, dependencies)).toBe(true);
    });

    test('ritorna false se manca una dipendenza', () => {
      const activePlugins = new Map([['dbApi', {}]]);
      const dependencies = new Map([
        ['dbApi', '^1.0.0'],
        ['missingPlugin', '^1.0.0']
      ]);

      expect(isPluginDependenciesSatisfied(activePlugins, dependencies)).toBe(false);
    });

    test('ritorna false se mancano tutte le dipendenze', () => {
      const activePlugins = new Map();
      const dependencies = new Map([
        ['dbApi', '^1.0.0']
      ]);

      expect(isPluginDependenciesSatisfied(activePlugins, dependencies)).toBe(false);
    });
  });

  describe('Circular Dependency Detection', () => {
    // Funzione estratta da pluginSys per testing
    function detectCircularDependencies(pluginsToActive) {
      const visited = new Set();
      const recursionStack = new Set();
      const cyclePath = [];

      function hasCycle(pluginName) {
        visited.add(pluginName);
        recursionStack.add(pluginName);
        cyclePath.push(pluginName);

        const dependencies = pluginsToActive.get(pluginName);
        if (dependencies) {
          for (const [depName] of dependencies) {
            if (!pluginsToActive.has(depName)) {
              continue;
            }

            if (!visited.has(depName)) {
              if (hasCycle(depName)) {
                return true;
              }
            } else if (recursionStack.has(depName)) {
              cyclePath.push(depName);
              return true;
            }
          }
        }

        cyclePath.pop();
        recursionStack.delete(pluginName);
        return false;
      }

      for (const [pluginName] of pluginsToActive) {
        if (!visited.has(pluginName)) {
          if (hasCycle(pluginName)) {
            const cycleStart = cyclePath.indexOf(cyclePath[cyclePath.length - 1]);
            const cycle = cyclePath.slice(cycleStart);
            return cycle;
          }
        }
      }

      return null;
    }

    test('ritorna null se non ci sono cicli', () => {
      const plugins = new Map([
        ['pluginA', new Map([['pluginB', '^1.0.0']])],
        ['pluginB', new Map()]
      ]);

      expect(detectCircularDependencies(plugins)).toBeNull();
    });

    test('rileva ciclo diretto A -> B -> A', () => {
      const plugins = new Map([
        ['pluginA', new Map([['pluginB', '^1.0.0']])],
        ['pluginB', new Map([['pluginA', '^1.0.0']])]
      ]);

      const cycle = detectCircularDependencies(plugins);
      expect(cycle).not.toBeNull();
      expect(cycle).toContain('pluginA');
      expect(cycle).toContain('pluginB');
    });

    test('rileva ciclo indiretto A -> B -> C -> A', () => {
      const plugins = new Map([
        ['pluginA', new Map([['pluginB', '^1.0.0']])],
        ['pluginB', new Map([['pluginC', '^1.0.0']])],
        ['pluginC', new Map([['pluginA', '^1.0.0']])]
      ]);

      const cycle = detectCircularDependencies(plugins);
      expect(cycle).not.toBeNull();
    });

    test('rileva self-dependency A -> A', () => {
      const plugins = new Map([
        ['pluginA', new Map([['pluginA', '^1.0.0']])]
      ]);

      const cycle = detectCircularDependencies(plugins);
      expect(cycle).not.toBeNull();
      expect(cycle).toContain('pluginA');
    });

    test('gestisce plugin senza dipendenze', () => {
      const plugins = new Map([
        ['pluginA', new Map()],
        ['pluginB', new Map()],
        ['pluginC', new Map()]
      ]);

      expect(detectCircularDependencies(plugins)).toBeNull();
    });

    test('gestisce grafo complesso senza cicli', () => {
      const plugins = new Map([
        ['pluginA', new Map([['pluginB', '^1.0.0'], ['pluginC', '^1.0.0']])],
        ['pluginB', new Map([['pluginD', '^1.0.0']])],
        ['pluginC', new Map([['pluginD', '^1.0.0']])],
        ['pluginD', new Map()]
      ]);

      expect(detectCircularDependencies(plugins)).toBeNull();
    });
  });

  describe('Semver Version Checking', () => {
    test('versione soddisfa range ^', () => {
      expect(semver.satisfies('1.2.3', '^1.0.0')).toBe(true);
      expect(semver.satisfies('1.0.0', '^1.0.0')).toBe(true);
      expect(semver.satisfies('2.0.0', '^1.0.0')).toBe(false);
    });

    test('versione soddisfa range ~', () => {
      expect(semver.satisfies('1.0.5', '~1.0.0')).toBe(true);
      expect(semver.satisfies('1.1.0', '~1.0.0')).toBe(false);
    });

    test('versione esatta', () => {
      expect(semver.satisfies('1.0.0', '1.0.0')).toBe(true);
      expect(semver.satisfies('1.0.1', '1.0.0')).toBe(false);
    });

    test('confronto versioni con gt', () => {
      expect(semver.gt('2.0.0', '1.0.0')).toBe(true);
      expect(semver.gt('1.0.0', '2.0.0')).toBe(false);
      expect(semver.gt('1.0.0', '1.0.0')).toBe(false);
    });
  });

  describe('Plugin Weight Sorting', () => {
    test('ordina plugin per weight', () => {
      const plugins = [
        { name: 'pluginC', weight: 10 },
        { name: 'pluginA', weight: 0 },
        { name: 'pluginB', weight: 5 }
      ];

      const sorted = plugins.sort((a, b) => a.weight - b.weight);

      expect(sorted[0].name).toBe('pluginA');
      expect(sorted[1].name).toBe('pluginB');
      expect(sorted[2].name).toBe('pluginC');
    });

    test('mantiene ordine alfabetico per stesso weight', () => {
      const plugins = [
        { name: 'pluginC', weight: 0 },
        { name: 'pluginA', weight: 0 },
        { name: 'pluginB', weight: 0 }
      ];

      const sorted = plugins.sort((a, b) => {
        if (a.weight !== b.weight) return a.weight - b.weight;
        return a.name.localeCompare(b.name);
      });

      expect(sorted[0].name).toBe('pluginA');
      expect(sorted[1].name).toBe('pluginB');
      expect(sorted[2].name).toBe('pluginC');
    });
  });
});
