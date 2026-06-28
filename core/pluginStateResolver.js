/**
 * pluginStateResolver — logica PURA di valutazione delle precondizioni dei
 * plugin e di risoluzione dello stato (available/incomplete/installed) con
 * propagazione a cascata. Nessun I/O: la lettura delle versioni npm installate
 * è iniettata dal chiamante, così la logica è testabile in isolamento.
 *
 * Fa parte della Fase 2 del ciclo di vita config (docs/decisions/config-lifecycle.it.md
 * §2, §4): precondizione = "Solo dipendenze" (npm + plugin). Il boot usa l'esito
 * per caricare i soli plugin `installed`, marcare gli altri `incomplete` (con
 * motivo) e completare SEMPRE con un box di riepilogo, invece di interrompersi.
 *
 * Stati (per i plugin `active:1` valutati):
 *   - `installed`  : tutte le precondizioni soddisfatte → caricabile.
 *   - `incomplete` : una precondizione manca; `reason` spiega quale.
 *     reason ∈ { 'npm', 'dep-missing', 'dep-version', 'dep-incomplete', 'circular' }.
 *
 * Cascata: se A dipende da B e B è `incomplete` (o assente, o in un ciclo), A
 * diventa `incomplete` ('dep-incomplete'). Calcolata a punto fisso (monotona:
 * gli stati passano solo da installed → incomplete, quindi termina).
 */

'use strict';

const semver = require('semver');

/**
 * Valuta le dipendenze npm di un plugin.
 *
 * @param {object|undefined} nodeModuleDependency - mappa { moduleName: semverRange }.
 * @param {(moduleName: string) => (string|null)} resolveInstalledVersion -
 *        ritorna la versione installata del modulo, o null se non installato.
 * @returns {{ok: boolean, missing: Array<{name,required}>, incompatible: Array<{name,required,installed}>}}
 */
function checkNpmDeps(nodeModuleDependency, resolveInstalledVersion) {
  const missing = [];
  const incompatible = [];

  if (nodeModuleDependency && typeof nodeModuleDependency === 'object') {
    for (const [name, required] of Object.entries(nodeModuleDependency)) {
      const installed = resolveInstalledVersion(name);
      if (installed == null) {
        missing.push({ name, required });
      } else if (!semver.satisfies(installed, required)) {
        incompatible.push({ name, required, installed });
      }
    }
  }

  return { ok: missing.length === 0 && incompatible.length === 0, missing, incompatible };
}

/**
 * Rileva i plugin coinvolti in dipendenze circolari, considerando solo gli archi
 * verso altri candidati. Ritorna l'insieme dei nomi coinvolti in almeno un ciclo
 * (DFS con recursion stack: a ogni back-edge marca il segmento del ciclo).
 *
 * @param {Array<{name: string, pluginDeps: Map<string,string>}>} candidates
 * @param {Set<string>} candidateNames
 * @returns {Set<string>}
 */
function detectCycles(candidates, candidateNames) {
  const depsByName = new Map(candidates.map((c) => [c.name, c.pluginDeps]));
  const inCycle = new Set();
  const visited = new Set();
  const stack = []; // percorso DFS corrente
  const onStack = new Set();

  function dfs(name) {
    visited.add(name);
    stack.push(name);
    onStack.add(name);

    const deps = depsByName.get(name);
    if (deps) {
      for (const depName of deps.keys()) {
        if (!candidateNames.has(depName)) continue; // arco verso un non-candidato: ignorato
        if (!visited.has(depName)) {
          dfs(depName);
        } else if (onStack.has(depName)) {
          // back-edge → ciclo: marca dal target fino in cima allo stack
          const start = stack.lastIndexOf(depName);
          for (let i = start; i < stack.length; i++) inCycle.add(stack[i]);
        }
      }
    }

    stack.pop();
    onStack.delete(name);
  }

  for (const c of candidates) {
    if (!visited.has(c.name)) dfs(c.name);
  }

  return inCycle;
}

/**
 * Risolve lo stato di ogni candidato (plugin `active:1`) con propagazione a cascata.
 *
 * @param {Array<{name: string, version: string, npmOk: boolean, npmDetail?: object, pluginDeps: Map<string,string>}>} candidates
 * @returns {Map<string, {state: 'installed'|'incomplete', reason: string|null, detail?: object}>}
 */
function resolvePluginStates(candidates) {
  const states = new Map();
  const versions = new Map();
  const candidateNames = new Set();
  for (const c of candidates) {
    versions.set(c.name, c.version);
    candidateNames.add(c.name);
  }

  // 1) Init: dipendenze npm non soddisfatte → incomplete.
  for (const c of candidates) {
    if (!c.npmOk) {
      states.set(c.name, { state: 'incomplete', reason: 'npm', detail: c.npmDetail || null });
    } else {
      states.set(c.name, { state: 'installed', reason: null });
    }
  }

  // 2) Cicli: marca incomplete i plugin coinvolti (solo tra quelli ancora installed).
  const cyclic = detectCycles(candidates, candidateNames);
  for (const name of cyclic) {
    if (states.get(name).state === 'installed') {
      states.set(name, { state: 'incomplete', reason: 'circular', detail: null });
    }
  }

  // 3) Cascata sulle dipendenze plugin, a punto fisso.
  const depsByName = new Map(candidates.map((c) => [c.name, c.pluginDeps]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of candidates) {
      if (states.get(c.name).state !== 'installed') continue;
      const deps = depsByName.get(c.name);
      for (const [depName, range] of deps) {
        const depState = states.get(depName);
        if (!depState) {
          states.set(c.name, { state: 'incomplete', reason: 'dep-missing', detail: { dep: depName, range } });
          changed = true;
          break;
        }
        if (depState.state === 'incomplete') {
          states.set(c.name, { state: 'incomplete', reason: 'dep-incomplete', detail: { dep: depName } });
          changed = true;
          break;
        }
        if (!semver.satisfies(versions.get(depName), range)) {
          states.set(c.name, {
            state: 'incomplete',
            reason: 'dep-version',
            detail: { dep: depName, range, version: versions.get(depName) },
          });
          changed = true;
          break;
        }
      }
    }
  }

  return states;
}

module.exports = { checkNpmDeps, resolvePluginStates, detectCycles };
