/**
 * pluginDepsReconciler — riconcilia le dipendenze npm di plugin e temi durante
 * un update (o su richiesta via `npm run deps-sync`). A DUE RAMI, coerente col
 * modello ibrido (config-lifecycle / self-update):
 *
 *   • Plugin/tema SELF-CONTAINED (ha un proprio package.json)
 *       → `npm install` DENTRO la sua cartella: le deps vivono in
 *         <dir>/node_modules e Node le risolve plugin-local (fallback su root).
 *
 *   • Plugin/tema LEGACY (nessun package.json, usa nodeModuleDependency)
 *       → per i moduli mancanti/incompatibili nel node_modules di ROOT esegue
 *         `npm install --no-save <pkg>@<range>` a root (il root package.json è di
 *         proprietà di git: un --save verrebbe comunque sovrascritto al prossimo
 *         checkout di una release).
 *
 * In PIÙ, per OGNI plugin/tema con config vivo, riallinea `nodeModuleDependency`
 * del vivo dal `.default` (fonte di verità aggiornata da git). Fixa il boot gate
 * quando una release cambia i range (il merge additivo dello schema NON tocca le
 * chiavi esistenti) o svuota il campo (migrazione a self-contained: es. adminMedia).
 *
 * Filosofia degli errori: warn-non-fatale (rispecchia il boot graceful — un
 * plugin con deps non risolte resta 'incomplete', il sistema non si blocca).
 *
 * Riusa la logica pura `checkNpmDeps` di core/pluginStateResolver.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const semver = require('semver');
const loadJson5 = require('../../core/loadJson5');
const setJson5Key = require('../../core/setJson5Key');
const { checkNpmDeps } = require('../../core/pluginStateResolver');

// Nome pacchetto npm valido (con eventuale scope). Serve a NON passare a
// `npm install` stringhe controllate da un plugin che potrebbero essere
// interpretate come opzioni (arg-injection): un plugin malevolo controlla il
// proprio nodeModuleDependency, quindi validiamo nome + range prima dell'install.
const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
function isValidDepSpec(name, range) {
  return typeof name === 'string' && NPM_NAME_RE.test(name)
    && typeof range === 'string' && semver.validRange(range) !== null;
}

const CONTAINERS = [
  { dir: 'plugins', descriptorDefault: 'pluginConfig.default.json5', descriptorLive: 'pluginConfig.json5' },
  { dir: 'themes', descriptorDefault: 'themeConfig.default.json5', descriptorLive: 'themeConfig.json5' },
];

/**
 * Un plugin va riconciliato solo se attivo (`active:1`), rispecchiando il boot
 * che valuta le dipendenze npm solo per i candidati attivi: evita build inutili
 * (es. better-sqlite3 nativo) per plugin disabilitati. Fonte: config vivo se
 * presente (l'utente può aver togglato), altrimenti il `.default`.
 * I TEMI non hanno il campo `active` (fonte di verità = ital8Config): processati
 * sempre (sono pochi e raramente hanno dipendenze npm).
 */
function shouldReconcile(pdir, c) {
  if (c.dir === 'themes') return true;
  const livePath = path.join(pdir, c.descriptorLive);
  const defaultPath = path.join(pdir, c.descriptorDefault);
  try {
    const src = fs.existsSync(livePath) ? livePath : defaultPath;
    return loadJson5(src).active === 1;
  } catch (_) {
    return false;
  }
}

/**
 * Legge la versione installata di un modulo nel node_modules di ROOT (a call
 * time, così un re-check dopo un install riflette il nuovo stato).
 */
function makeRootResolver(projectRoot) {
  return (moduleName) => {
    const p = path.join(projectRoot, 'node_modules', moduleName, 'package.json');
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')).version || null; } catch (_) { return null; }
  };
}

/**
 * Ambiente sanificato per il `npm install` annidato: rimuove le variabili di
 * "prefix" ereditate dal npm padre (npm run / postinstall) che altrimenti
 * farebbero installare le deps del plugin nella cartella sbagliata. Proxy,
 * registry e cache restano intatti.
 */
function sanitizedNpmEnv() {
  const env = { ...process.env };
  delete env.npm_config_local_prefix;
  delete env.npm_config_prefix;
  delete env.INIT_CWD;
  return env;
}

function runNpm(args, cwd) {
  execFileSync('npm', args, { cwd, stdio: 'inherit', env: sanitizedNpmEnv() });
}

/**
 * @param {string} projectRoot
 * @param {object} [opts]
 * @param {boolean} [opts.clean=false] - usa `npm ci` invece di `npm install` (rami self-contained).
 * @param {boolean} [opts.dryRun=false] - non installa/scrive: riporta soltanto.
 * @param {(msg:string)=>void} [opts.onLog] - callback di log riga per riga.
 * @returns {Promise<{perPlugin:Array, legacy:Array, realigned:Array, warnings:string[]}>}
 */
async function reconcile(projectRoot, opts = {}) {
  const clean = opts.clean === true;
  const dryRun = opts.dryRun === true;
  const onLog = typeof opts.onLog === 'function' ? opts.onLog : () => {};

  const report = { perPlugin: [], legacy: [], realigned: [], warnings: [] };
  const resolveRoot = makeRootResolver(projectRoot);

  for (const c of CONTAINERS) {
    const base = path.join(projectRoot, c.dir);
    if (!fs.existsSync(base)) continue;

    for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const name = ent.name;
      const pdir = path.join(base, name);
      if (!shouldReconcile(pdir, c)) continue; // salta i plugin disabilitati
      const defaultPath = path.join(pdir, c.descriptorDefault);
      const livePath = path.join(pdir, c.descriptorLive);
      const hasPkg = fs.existsSync(path.join(pdir, 'package.json'));

      // ── Pass A: riallinea nodeModuleDependency del vivo dal default ──────────
      if (fs.existsSync(defaultPath) && fs.existsSync(livePath)) {
        try {
          const defNMD = (loadJson5(defaultPath).nodeModuleDependency) || {};
          const liveNMD = (loadJson5(livePath).nodeModuleDependency) || {};
          if (JSON.stringify(defNMD) !== JSON.stringify(liveNMD)) {
            if (!dryRun) await setJson5Key(livePath, 'nodeModuleDependency', defNMD);
            report.realigned.push({ container: c.dir, name, to: defNMD });
            onLog(`↺ realign ${c.dir}/${name}: nodeModuleDependency ← default`);
          }
        } catch (err) {
          report.warnings.push(`realign ${c.dir}/${name}: ${err.message}`);
        }
      }

      // ── Pass B: install ──────────────────────────────────────────────────────
      if (hasPkg) {
        // Ramo self-contained.
        onLog(`⇩ npm ${clean ? 'ci' : 'install'} in ${c.dir}/${name}`);
        if (dryRun) { report.perPlugin.push({ container: c.dir, name, dryRun: true }); continue; }
        try {
          runNpm([clean ? 'ci' : 'install', '--no-audit', '--no-fund'], pdir);
          report.perPlugin.push({ container: c.dir, name, ok: true });
        } catch (err) {
          report.perPlugin.push({ container: c.dir, name, ok: false });
          report.warnings.push(`${c.dir}/${name}: npm ${clean ? 'ci' : 'install'} fallito (${String(err.message).split('\n')[0]})`);
        }
      } else {
        // Ramo legacy: deps dichiarate in nodeModuleDependency del default → root --no-save.
        let defNMD = {};
        try { defNMD = (loadJson5(defaultPath).nodeModuleDependency) || {}; } catch (_) {}
        const check = checkNpmDeps(defNMD, resolveRoot);
        if (check.ok) continue; // nulla da fare

        const specs = [];
        for (const d of [...check.missing, ...check.incompatible]) {
          if (!isValidDepSpec(d.name, d.required)) {
            report.warnings.push(`${c.dir}/${name}: dipendenza dichiarata non valida, ignorata (${JSON.stringify(d.name)}@${JSON.stringify(d.required)})`);
            continue;
          }
          specs.push(`${d.name}@${d.required}`);
        }
        if (specs.length === 0) continue;
        onLog(`⇩ root --no-save (${c.dir}/${name}): ${specs.join(' ')}`);
        if (dryRun) { report.legacy.push({ container: c.dir, name, wouldInstall: specs, dryRun: true }); continue; }
        try {
          runNpm(['install', '--no-save', '--no-audit', '--no-fund', ...specs], projectRoot);
        } catch (err) {
          report.warnings.push(`${c.dir}/${name}: root npm install --no-save fallito (${String(err.message).split('\n')[0]})`);
        }
        const recheck = checkNpmDeps(defNMD, resolveRoot);
        if (!recheck.ok) {
          const unresolved = [...recheck.missing, ...recheck.incompatible].map((d) => d.name).join(', ');
          report.warnings.push(`${c.dir}/${name}: deps non risolte (${unresolved}) → il plugin resterà 'incomplete'`);
        }
        report.legacy.push({ container: c.dir, name, installed: specs, ok: recheck.ok });
      }
    }
  }

  return report;
}

module.exports = { reconcile, CONTAINERS };
