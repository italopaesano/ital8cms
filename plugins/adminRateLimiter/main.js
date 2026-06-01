/**
 * adminRateLimiter — main.js
 *
 * Plugin admin gemello di `rateLimiter`. Fornisce la GUI nel pannello admin per:
 *   - monitorare i blocchi attivi e l'audit log (Vista Dati);
 *   - (Step successivi) gestire le regole e le impostazioni del rate limiter.
 *
 * Tutti i dati e le azioni passano per l'oggetto condiviso di `rateLimiter`
 * (stesso processo): `pluginSys.getSharedObject('rateLimiter')`. Se il servizio è
 * disattivato l'oggetto è `null` e la GUI mostra lo stato "disattivato".
 *
 * Vedi la convenzione "Twin Admin Plugin" e "The Three Views" in CLAUDE.md.
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
let ownFolder = null; // cartella di questo plugin (per i backup)

// Il rate limiter è sensibile: accesso riservato a root (0) e admin (1).
const pluginAccess = {
  requiresAuth: true,
  allowedRoles: [0, 1],
};

/** Tira l'oggetto condiviso di rateLimiter (null se servizio assente/disattivo). */
function getRateLimiter() {
  return myPluginSys ? myPluginSys.getSharedObject('rateLimiter') : null;
}

/** Cartella del plugin di servizio rateLimiter (per leggere/scrivere i suoi .json5). */
function rateLimiterFolder() {
  const p = myPluginSys && myPluginSys.getPlugin('rateLimiter');
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
      // ── Vista Dati: stato + statistiche + blocchi attivi ──
      {
        method: 'GET',
        path: '/status',
        access: pluginAccess,
        handler: async (ctx) => {
          const rl = getRateLimiter();
          if (!rl) {
            ctx.body = { enabled: false };
            return;
          }
          ctx.body = {
            enabled: true,
            stats: rl.getStats(),
            activeBlocks: rl.getActiveBlocks(),
            ruleNames: rl.getRuleNames(),
          };
        },
      },

      // ── Vista Dati: coda dell'audit log ──
      {
        method: 'GET',
        path: '/attempts',
        access: pluginAccess,
        handler: async (ctx) => {
          const rl = getRateLimiter();
          if (!rl) {
            ctx.body = { enabled: false, attempts: [] };
            return;
          }
          const MAX = 500;
          const reqLimit = parseInt(ctx.query.limit, 10);
          const limit = Number.isFinite(reqLimit) && reqLimit > 0
            ? Math.min(reqLimit, MAX)
            : (custom.auditLimit || 100);

          const filter = {};
          if (limit) filter.limit = limit;
          if (ctx.query.clientId) filter.clientId = String(ctx.query.clientId);
          if (ctx.query.ruleName) filter.ruleName = String(ctx.query.ruleName);
          if (ctx.query.event) filter.event = String(ctx.query.event);

          ctx.body = { enabled: true, attempts: rl.getRecentAttempts(filter) };
        },
      },

      // ── Azione live: sblocca un IP per una regola ──
      {
        method: 'POST',
        path: '/unblock',
        access: pluginAccess,
        handler: async (ctx) => {
          const rl = getRateLimiter();
          if (!rl) {
            ctx.status = 409;
            ctx.body = { success: false, error: 'rateLimiter disattivato' };
            return;
          }
          const { clientId, ruleName } = ctx.request.body || {};
          if (!clientId || !ruleName) {
            ctx.status = 400;
            ctx.body = { success: false, error: 'clientId e ruleName sono obbligatori' };
            return;
          }
          const released = rl.releaseBlock(String(clientId), String(ruleName));
          ctx.body = { success: true, released };
        },
      },

      // ── Azione live: ban manuale di un IP per una regola ──
      {
        method: 'POST',
        path: '/ban',
        access: pluginAccess,
        handler: async (ctx) => {
          const rl = getRateLimiter();
          if (!rl) {
            ctx.status = 409;
            ctx.body = { success: false, error: 'rateLimiter disattivato' };
            return;
          }
          const { clientId, ruleName, seconds, tier } = ctx.request.body || {};
          if (!clientId || !ruleName) {
            ctx.status = 400;
            ctx.body = { success: false, error: 'clientId e ruleName sono obbligatori' };
            return;
          }
          const opts = {};
          const sec = parseInt(seconds, 10);
          if (Number.isFinite(sec) && sec > 0) opts.seconds = sec;
          if (tier === 'short' || tier === 'long') opts.tier = tier;

          const verdict = rl.banClient(String(clientId), String(ruleName), opts);
          ctx.body = { success: true, verdict };
        },
      },

      // ── Regole: carica il contenuto grezzo di protectedRoutes.json5 ──
      {
        method: 'GET',
        path: '/rules',
        access: pluginAccess,
        handler: async (ctx) => {
          const folder = rateLimiterFolder();
          if (!folder) {
            ctx.status = 409;
            ctx.body = { enabled: false, error: 'rateLimiter non disponibile' };
            return;
          }
          let content = '';
          try {
            content = configFileManager.readRaw(path.join(folder, 'protectedRoutes.json5'));
          } catch (e) {
            content = '';
          }
          // enabled = servizio attivo (necessario per validare/salvare)
          ctx.body = { enabled: !!getRateLimiter(), content };
        },
      },

      // ── Regole: valida senza salvare ──
      {
        method: 'POST',
        path: '/validate-rules',
        access: pluginAccess,
        handler: async (ctx) => {
          const rl = getRateLimiter();
          if (!rl) {
            ctx.status = 409;
            ctx.body = { valid: false, errors: ['rateLimiter disattivato'], warnings: [] };
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
          ctx.body = rl.validateRules(parsed);
        },
      },

      // ── Regole: salva (valida → backup → scrittura atomica → reloadRules) ──
      {
        method: 'POST',
        path: '/rules',
        access: pluginAccess,
        handler: async (ctx) => {
          const rl = getRateLimiter();
          const folder = rateLimiterFolder();
          if (!rl || !folder) {
            ctx.status = 409;
            ctx.body = { success: false, error: 'rateLimiter disattivato' };
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
          const result = rl.validateRules(parsed);
          if (!result.valid) {
            ctx.status = 400;
            ctx.body = { success: false, errors: result.errors, warnings: result.warnings };
            return;
          }
          const file = path.join(folder, 'protectedRoutes.json5');
          try {
            configFileManager.backup(file, backupDir(), maxBackups);
            configFileManager.writeAtomic(file, content);
            rl.reloadRules();
          } catch (e) {
            ctx.status = 500;
            ctx.body = { success: false, error: 'Scrittura fallita: ' + e.message };
            return;
          }
          ctx.body = { success: true, warnings: result.warnings };
        },
      },

      // ── Impostazioni: carica il blocco custom di pluginConfig.json5 ──
      {
        method: 'GET',
        path: '/config',
        access: pluginAccess,
        handler: async (ctx) => {
          const folder = rateLimiterFolder();
          if (!folder) {
            ctx.status = 409;
            ctx.body = { enabled: false, error: 'rateLimiter non disponibile' };
            return;
          }
          let content = '{}';
          try {
            const cfg = loadJson5(path.join(folder, 'pluginConfig.json5'));
            content = JSON.stringify(cfg.custom || {}, null, 2);
          } catch (e) {
            content = '{}';
          }
          ctx.body = { enabled: !!getRateLimiter(), content };
        },
      },

      // ── Impostazioni: valida senza salvare ──
      {
        method: 'POST',
        path: '/validate-config',
        access: pluginAccess,
        handler: async (ctx) => {
          const rl = getRateLimiter();
          if (!rl) {
            ctx.status = 409;
            ctx.body = { valid: false, errors: ['rateLimiter disattivato'], warnings: [] };
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
          ctx.body = rl.validateConfig(parsed);
        },
      },

      // ── Impostazioni: salva (valida → backup → editJson5 'custom' → reloadConfig) ──
      {
        method: 'POST',
        path: '/config',
        access: pluginAccess,
        handler: async (ctx) => {
          const rl = getRateLimiter();
          const folder = rateLimiterFolder();
          if (!rl || !folder) {
            ctx.status = 409;
            ctx.body = { success: false, error: 'rateLimiter disattivato' };
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
          const result = rl.validateConfig(parsed);
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
            rl.reloadConfig(); // hot-reload di defaults + enforcement
          } catch (e) {
            ctx.status = 500;
            ctx.body = { success: false, error: 'Scrittura fallita: ' + e.message };
            return;
          }
          ctx.body = { success: true, warnings: result.warnings };
        },
      },

      // ── Salva e riavvia: richiede un restart pulito (i blocchi persistono) ──
      {
        method: 'POST',
        path: '/restart',
        access: pluginAccess,
        handler: async (ctx) => {
          if (myPluginSys && typeof myPluginSys.requestRestart === 'function') {
            myPluginSys.requestRestart({ reason: 'adminRateLimiter: modifica impostazioni' });
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
