/**
 * adminCsrfProtection — main.js
 *
 * Plugin admin gemello di `csrfProtection`. Fornisce la GUI nel pannello admin:
 *   - Vista Dati: KPI + blocchi CSRF recenti + simulatore di richiesta;
 *   - Editor JSON5: edita il blocco `custom` di pluginConfig.json5 del servizio.
 *
 * Tutti i dati/azioni/validazioni passano per l'oggetto condiviso di
 * `csrfProtection` (stesso processo): `pluginSys.getSharedObject('csrfProtection')`.
 * Se il servizio è disattivato l'oggetto è `null` e la GUI mostra "disattivato".
 *
 * Vedi le convenzioni "Twin Admin Plugin" e "The Three Views" in CLAUDE.md.
 */

'use strict';

const path = require('path');
const JSON5 = require('json5');
const loadJson5 = require('../../core/loadJson5');
const editJson5 = require('../../core/editJson5');
const configFileManager = require('./lib/configFileManager');

const pluginName = path.basename(__dirname);

// Config caricata a livello di modulo: serve già pronta in getObjectToShareToWebPages(),
// che pluginSys invoca PRIMA di loadPlugin().
const ownConfig = loadJson5(path.join(__dirname, 'pluginConfig.json5'));
const custom = ownConfig.custom || {};
const maxBackups = custom.maxBackupsPerFile || 10;

let myPluginSys = null;
let ownFolder = null;

// Configurazione di sicurezza è sensibile: accesso riservato a root (0) e admin (1).
const pluginAccess = {
  requiresAuth: true,
  allowedRoles: [0, 1],
};

/** Tira l'oggetto condiviso di csrfProtection (null se servizio assente/disattivo). */
function getCsrf() {
  return myPluginSys ? myPluginSys.getSharedObject('csrfProtection') : null;
}

/** Cartella del plugin di servizio csrfProtection (per leggere/scrivere i suoi .json5). */
function csrfFolder() {
  const p = myPluginSys && myPluginSys.getPlugin('csrfProtection');
  return (p && p.pathPluginFolder) ? p.pathPluginFolder : null;
}

/** Cartella backup di questo plugin admin. */
function backupDir() {
  return path.join(ownFolder || __dirname, 'backups');
}

module.exports = {
  async loadPlugin(pluginSys, pathPluginFolder) {
    myPluginSys = pluginSys;
    ownFolder = pathPluginFolder;
    console.log(`[${pluginName}] Plugin loaded`);
  },

  // Espone ai template i parametri UI (letti dalla config del plugin).
  getObjectToShareToWebPages() {
    return {
      autoRefreshSeconds: custom.autoRefreshSeconds || 5,
      auditLimit: custom.auditLimit || 100,
    };
  },

  getRouteArray() {
    return [
      // ── Vista Dati: stato + statistiche ──
      {
        method: 'GET',
        path: '/status',
        access: pluginAccess,
        handler: async (ctx) => {
          const csrf = getCsrf();
          if (!csrf) {
            ctx.body = { enabled: false };
            return;
          }
          ctx.body = { enabled: true, stats: csrf.getStats() };
        },
      },

      // ── Vista Dati: blocchi CSRF recenti (audit in memoria) ──
      {
        method: 'GET',
        path: '/recent',
        access: pluginAccess,
        handler: async (ctx) => {
          const csrf = getCsrf();
          if (!csrf) {
            ctx.body = { enabled: false, blocks: [] };
            return;
          }
          const MAX = 500;
          const reqLimit = parseInt(ctx.query.limit, 10);
          const limit = Number.isFinite(reqLimit) && reqLimit > 0
            ? Math.min(reqLimit, MAX)
            : (custom.auditLimit || 100);
          ctx.body = { enabled: true, blocks: csrf.getRecentBlocks(limit) };
        },
      },

      // ── Azione live: CSRF tester (valuta una richiesta sintetica) ──
      {
        method: 'POST',
        path: '/simulate',
        access: pluginAccess,
        handler: async (ctx) => {
          const csrf = getCsrf();
          if (!csrf) {
            ctx.status = 409;
            ctx.body = { success: false, error: 'csrfProtection disattivato' };
            return;
          }
          const body = ctx.request.body || {};
          const verdict = csrf.simulate({
            method: body.method,
            path: body.path,
            siteOrigin: body.siteOrigin,
            requestOrigin: body.requestOrigin,
            tokenProvided: body.tokenProvided === true || body.tokenProvided === 'true',
          });
          ctx.body = { success: true, verdict };
        },
      },

      // ── Impostazioni: carica il blocco custom di pluginConfig.json5 ──
      {
        method: 'GET',
        path: '/config',
        access: pluginAccess,
        handler: async (ctx) => {
          const folder = csrfFolder();
          if (!folder) {
            ctx.status = 409;
            ctx.body = { enabled: false, error: 'csrfProtection non disponibile' };
            return;
          }
          let content = '{}';
          try {
            const cfg = loadJson5(path.join(folder, 'pluginConfig.json5'));
            content = JSON.stringify(cfg.custom || {}, null, 2);
          } catch (e) {
            content = '{}';
          }
          ctx.body = { enabled: !!getCsrf(), content };
        },
      },

      // ── Impostazioni: valida senza salvare ──
      {
        method: 'POST',
        path: '/validate-config',
        access: pluginAccess,
        handler: async (ctx) => {
          const csrf = getCsrf();
          if (!csrf) {
            ctx.status = 409;
            ctx.body = { valid: false, errors: ['csrfProtection disattivato'], warnings: [] };
            return;
          }
          const { content } = ctx.request.body || {};
          if (typeof content !== 'string') {
            ctx.status = 400;
            ctx.body = { valid: false, errors: ['content (stringa) obbligatorio'], warnings: [] };
            return;
          }
          let parsed;
          try {
            parsed = JSON5.parse(content);
          } catch (e) {
            ctx.body = { valid: false, errors: ['JSON5 non valido: ' + e.message], warnings: [] };
            return;
          }
          ctx.body = csrf.validateConfig(parsed);
        },
      },

      // ── Impostazioni: salva (valida → backup → editJson5 'custom' → reloadConfig) ──
      {
        method: 'POST',
        path: '/config',
        access: pluginAccess,
        handler: async (ctx) => {
          const csrf = getCsrf();
          const folder = csrfFolder();
          if (!csrf || !folder) {
            ctx.status = 409;
            ctx.body = { success: false, error: 'csrfProtection disattivato' };
            return;
          }
          const { content } = ctx.request.body || {};
          if (typeof content !== 'string') {
            ctx.status = 400;
            ctx.body = { success: false, error: 'content (stringa) obbligatorio' };
            return;
          }
          let parsed;
          try {
            parsed = JSON5.parse(content);
          } catch (e) {
            ctx.status = 400;
            ctx.body = { success: false, error: 'JSON5 non valido: ' + e.message };
            return;
          }
          const result = csrf.validateConfig(parsed);
          if (!result.valid) {
            ctx.status = 400;
            ctx.body = { success: false, errors: result.errors, warnings: result.warnings };
            return;
          }
          const file = path.join(folder, 'pluginConfig.json5');
          try {
            // editJson5 sostituisce SOLO il blocco "custom", preservando il resto
            // del file (active/isInstalled/weight/dependency e i loro commenti).
            configFileManager.backup(file, backupDir(), maxBackups);
            await editJson5(file, 'custom', parsed);
            csrf.reloadConfig(); // hot-reload della policy CSRF
          } catch (e) {
            ctx.status = 500;
            ctx.body = { success: false, error: 'Scrittura fallita: ' + e.message };
            return;
          }
          ctx.body = { success: true, warnings: result.warnings };
        },
      },

      // ── Salva e riavvia: per cambi strutturali (es. abilitare il plugin da
      //    spento, che richiede di re-registrare middleware e hook al boot) ──
      {
        method: 'POST',
        path: '/restart',
        access: pluginAccess,
        handler: async (ctx) => {
          if (myPluginSys && typeof myPluginSys.requestRestart === 'function') {
            myPluginSys.requestRestart({ reason: 'adminCsrfProtection: modifica impostazioni' });
            ctx.body = { success: true, restarting: true };
          } else {
            ctx.status = 501;
            ctx.body = { success: false, error: 'restart non supportato in questo ambiente' };
          }
        },
      },
    ];
  },
};
