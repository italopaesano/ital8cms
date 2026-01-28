/**
 * ACCESS MANAGER
 *
 * Gestisce la logica di controllo accessi per pagine e route.
 *
 * Funzionalità:
 * - Carica regole da accessControl.json5
 * - Verifica permessi per URL richiesto
 * - Gestisce redirect per accesso negato
 * - Integrazione con sistema ruoli adminUsers
 * - Cache delle regole (reload al boot + on save)
 */

const PatternMatcher = require('./patternMatcher');
const loadJson5 = require('../../../core/loadJson5');
const path = require('path');

class AccessManager {
  constructor(pluginSys, pathPluginFolder) {
    this.pluginSys = pluginSys;
    this.pathPluginFolder = pathPluginFolder;
    this.patternMatcher = new PatternMatcher();

    // Cache regole
    this.rules = null;
    this.defaultPolicy = null;

    // Carica regole all'inizializzazione
    this.loadRules();
  }

  /**
   * Carica regole da accessControl.json5
   * Chiamato al boot e quando admin salva modifiche
   */
  loadRules() {
    try {
      const configPath = path.join(this.pathPluginFolder, 'accessControl.json5');
      const config = loadJson5(configPath);

      // Combina hardcodedRules e customRules in un unico oggetto
      // (hardcodedRules hanno priorità se ci sono duplicati, ma non dovrebbero esserci)
      this.rules = {
        ...config.customRules,
        ...config.hardcodedRules // Hardcoded sovrascrive custom se conflitto
      };

      this.defaultPolicy = config.defaultPolicy;

      console.log(`[AccessManager] Rules loaded: ${Object.keys(this.rules).length} patterns`);
    } catch (err) {
      console.error('[AccessManager] Failed to load accessControl.json5', err);
      // Fallback: nessuna regola
      this.rules = {};
      this.defaultPolicy = { action: 'allow', redirectOnDenied: '/pluginPages/adminUsers/login.ejs' };
    }
  }

  /**
   * Reload regole (chiamato quando admin salva modifiche)
   */
  reloadRules() {
    console.log('[AccessManager] Reloading rules...');
    this.loadRules();
  }

  /**
   * Verifica se un utente può accedere a un URL
   * @param {string} url - URL richiesto
   * @param {object} user - Oggetto user da ctx.session.user (o null se non autenticato)
   * @returns {object} - { allowed: boolean, redirect: string|null, status: number|null, reason: string }
   */
  checkAccess(url, user = null) {
    // 1. Trova regola matching
    const rule = this.patternMatcher.findMatchingRule(url, this.rules);

    // 2. Se nessuna regola matcha, applica default policy
    if (!rule) {
      return this.applyDefaultPolicy(user);
    }

    // 3. Verifica autenticazione
    if (rule.requiresAuth && !user) {
      return {
        allowed: false,
        redirect: this.defaultPolicy.redirectOnDenied,
        status: null, // Redirect, non status code
        reason: 'Authentication required'
      };
    }

    // 4. Verifica ruoli
    if (rule.requiresAuth && rule.allowedRoles && rule.allowedRoles.length > 0) {
      const userRoles = user.roleIds || [];
      const hasRequiredRole = userRoles.some(roleId => rule.allowedRoles.includes(roleId));

      if (!hasRequiredRole) {
        // Utente autenticato ma senza ruolo necessario → 403 o redirect custom
        return {
          allowed: false,
          redirect: '/pluginPages/adminAccessControl/access-denied.ejs', // Pagina custom
          status: null,
          reason: `Required roles: ${rule.allowedRoles.join(', ')}, user has: ${userRoles.join(', ')}`
        };
      }
    }

    // 5. Accesso consentito
    return {
      allowed: true,
      redirect: null,
      status: null,
      reason: 'Access granted'
    };
  }

  /**
   * Applica default policy quando nessuna regola matcha
   * @param {object} user - Utente (o null)
   * @returns {object} - { allowed: boolean, redirect: string|null, status: number|null, reason: string }
   */
  applyDefaultPolicy(user) {
    switch (this.defaultPolicy.action) {
      case 'allow':
        // Pubblico, tutti possono accedere
        return {
          allowed: true,
          redirect: null,
          status: null,
          reason: 'Default policy: allow'
        };

      case 'deny':
        // Negato per tutti
        return {
          allowed: false,
          redirect: null,
          status: 403,
          reason: 'Default policy: deny'
        };

      case 'requireAuth':
        // Solo utenti autenticati
        if (!user) {
          return {
            allowed: false,
            redirect: this.defaultPolicy.redirectOnDenied,
            status: null,
            reason: 'Default policy: requireAuth'
          };
        }
        return {
          allowed: true,
          redirect: null,
          status: null,
          reason: 'Default policy: requireAuth (user authenticated)'
        };

      default:
        // Fallback: allow
        return {
          allowed: true,
          redirect: null,
          status: null,
          reason: 'Unknown default policy, fallback to allow'
        };
    }
  }

  /**
   * Middleware factory: crea middleware Koa per access control
   * @returns {function} - Middleware Koa
   */
  createMiddleware() {
    return async (ctx, next) => {
      const url = ctx.path;
      const user = ctx.session?.user || null;

      // Verifica accesso
      const accessResult = this.checkAccess(url, user);

      if (!accessResult.allowed) {
        // Accesso negato

        // Log per debugging
        console.log(`[AccessControl] Access denied: ${url} - ${accessResult.reason}`);

        // Redirect (per utenti non autenticati)
        if (accessResult.redirect) {
          ctx.redirect(accessResult.redirect);
          return;
        }

        // Status code (per utenti autenticati senza permessi)
        if (accessResult.status) {
          ctx.status = accessResult.status;
          ctx.body = { error: 'Access Denied', reason: accessResult.reason };
          return;
        }
      }

      // Accesso consentito, prosegui
      await next();
    };
  }

  /**
   * Helper per EJS: verifica accesso in template
   * Usato da passData.accessControl.check() nei file EJS
   *
   * @param {object} ctx - Contesto Koa
   * @param {object} requirements - { requiresAuth: boolean, allowedRoles: array }
   * @returns {void} - Fa redirect se accesso negato
   */
  checkInTemplate(ctx, requirements) {
    const user = ctx.session?.user || null;

    // Verifica autenticazione
    if (requirements.requiresAuth && !user) {
      ctx.redirect(this.defaultPolicy.redirectOnDenied);
      return;
    }

    // Verifica ruoli
    if (requirements.allowedRoles && requirements.allowedRoles.length > 0) {
      const userRoles = user?.roleIds || [];
      const hasRequiredRole = userRoles.some(roleId => requirements.allowedRoles.includes(roleId));

      if (!hasRequiredRole) {
        ctx.redirect('/pluginPages/adminAccessControl/access-denied.ejs');
        return;
      }
    }

    // Accesso consentito (nessun redirect)
  }

  /**
   * Ottieni regole per visualizzazione in admin UI
   * @returns {object} - { hardcodedRules, customRules, defaultPolicy }
   */
  getRulesForUI() {
    const configPath = path.join(this.pathPluginFolder, 'accessControl.json5');
    const config = loadJson5(configPath);

    return {
      hardcodedRules: config.hardcodedRules,
      customRules: config.customRules,
      defaultPolicy: config.defaultPolicy
    };
  }

  /**
   * Salva regole modificate da admin UI
   * @param {object} newConfig - Nuova configurazione completa
   * @returns {object} - { success: boolean, error: string|null }
   */
  saveRules(newConfig) {
    try {
      const fs = require('fs');
      const configPath = path.join(this.pathPluginFolder, 'accessControl.json5');

      // Scrivi file (con backup temporaneo)
      const tempPath = configPath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(newConfig, null, 2), 'utf8');
      fs.renameSync(tempPath, configPath);

      // Reload regole
      this.reloadRules();

      return { success: true, error: null };
    } catch (err) {
      console.error('[AccessManager] Failed to save rules', err);
      return { success: false, error: err.message };
    }
  }
}

module.exports = AccessManager;
