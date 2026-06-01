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
const loadJson5 = require('../../core/loadJson5');

const pluginName = path.basename(__dirname);

// Config caricata a livello di modulo: serve già pronta in getObjectToShareToWebPages(),
// che pluginSys invoca PRIMA di loadPlugin().
const ownConfig = loadJson5(path.join(__dirname, 'pluginConfig.json5'));
const custom = ownConfig.custom || {};

let myPluginSys = null;

// Il rate limiter è sensibile: accesso riservato a root (0) e admin (1).
const pluginAccess = {
  requiresAuth: true,
  allowedRoles: [0, 1],
};

/** Tira l'oggetto condiviso di rateLimiter (null se servizio assente/disattivo). */
function getRateLimiter() {
  return myPluginSys ? myPluginSys.getSharedObject('rateLimiter') : null;
}

module.exports = {
  async loadPlugin(pluginSys, pathPluginFolder) {
    myPluginSys = pluginSys;
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
    ];
  },
};
