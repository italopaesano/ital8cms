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

const PatternMatcher = require('../../../core/patternMatcher');
const loadJson5 = require('../../../core/loadJson5');
const { canonicalizePath } = require('../../../core/pathCanonicalizer');
const {
  resolvePathZones,
  resolveRuleset,
  zoneForPath,
  tightenAccess,
} = require('../../../core/pathZoneResolver');
const path = require('path');

class AccessManager {
  constructor(pluginSys, pathPluginFolder) {
    this.pluginSys = pluginSys;
    this.pathPluginFolder = pathPluginFolder;
    this.patternMatcher = new PatternMatcher();

    // Cache regole
    this.rules = null;
    this.defaultPolicy = null;

    // globalPrefix (deploy-wide path prefix): serve per (a) normalizzare il path da
    // confrontare con i pattern — che sono logici, SENZA prefix — e (b) prefissare i
    // redirect verso pagine interne. Letto una volta (non cambia a runtime); default
    // "" se il config non è leggibile.
    this.globalPrefix = '';
    let ital8Conf = {};
    try {
      ital8Conf = loadJson5(path.join(pathPluginFolder, '..', '..', 'ital8Config.json5'));
      this.globalPrefix = ital8Conf.globalPrefix || '';
    } catch (_) { /* default "" */ }

    // Mappa delle zone dello spazio URL (`pathZones`). Costruita QUI, prima di
    // loadRules(), perché la risoluzione dei segnaposti nei pattern ne ha bisogno.
    // I prefissi non cambiano a runtime (richiedono un riavvio), quindi la mappa si
    // costruisce una volta sola, come globalPrefix.
    // → docs/decisions/path-zones.it.md
    this.pathZones = resolvePathZones(ital8Conf);

    // Problemi rilevati al caricamento del ruleset. In Fase 3 diventeranno il box
    // `[ACCESS]` e un errore fatale al boot; per ora sono conservati e segnalati.
    this.rulesetProblems = [];

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
      const declared = {
        ...config.customRules,
        ...config.hardcodedRules // Hardcoded sovrascrive custom se conflitto
      };

      // Risolve i segnaposti di percorso (`{{admin}}` → il prefisso configurato),
      // deriva le forme con/senza estensione quando hideExtension è attivo, e
      // rileva collisioni e violazioni del baseline di zona.
      // `resolveRuleset` SCARTA i pattern che non ha capito: un segnaposto non
      // risolto non diventa mai un letterale (contratto fail-closed, D2).
      const resolved = resolveRuleset(declared, this.pathZones);
      this.rules = resolved.rules;
      this.rulesetProblems = [...this.pathZones.problems, ...resolved.problems];

      this.defaultPolicy = config.defaultPolicy;

      console.log(`[AccessManager] Rules loaded: ${Object.keys(this.rules).length} patterns`
        + (resolved.derived.length > 0 ? ` (${resolved.derived.length} derivate da hideExtension)` : ''));

      // Fase 2: si segnala. In Fase 3 questi diventano il box `[ACCESS]` e un
      // errore fatale al boot — un ruleset non capito non deve servire un sito.
      for (const problem of this.rulesetProblems) {
        console.warn(`[AccessManager] ⚠  ${problem.kind}: ${problem.detail || ''}`
          + (problem.pattern ? ` — pattern "${problem.pattern}"` : '')
          + (problem.zone ? ` — zona "${problem.zone}"` : ''));
      }
    } catch (err) {
      console.error('[AccessManager] Failed to load accessControl.json5', err);
      // Fallback: nessuna regola. NON è più un fallback aperto: il `baseline` delle
      // zone chiuse vive in codice (`core/pathZoneResolver.js`), quindi con zero
      // regole il pannello admin resta comunque protetto. È il punto dell'intera
      // decisione — prima di essa un accessControl.json5 illeggibile apriva il
      // pannello a chiunque.
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

    // 2. Il `baseline` della ZONA a cui la URL appartiene (D3).
    //
    // La zona si ricava dalla URL RICHIESTA, non dal pattern: così il minimo
    // d'accesso vale anche dove il controllo al caricamento non arriva (una regola
    // `regex:`, di cui non si sa la zona leggendone il testo).
    const zone = zoneForPath(url, this.pathZones.zones);
    const baseline = zone ? zone.baseline : null;

    // 3. Nessuna regola E nessun minimo da imporre → `defaultPolicy`, come sempre.
    //
    // È il punto in cui le zone APERTE restano identiche a prima: sul sito pubblico,
    // su pluginPages e sulle risorse del tema continua a decidere la `defaultPolicy`
    // configurata dall'amministratore, che resta la sua. Il cambiamento di
    // comportamento riguarda SOLO le zone chiuse (admin, views, risorse admin), dove
    // « nessuna regola » non significa più « pubblico » — ed è esattamente il difetto
    // A1: cambiare `adminPrefix` faceva cadere il pannello qui, su `action: "allow"`.
    if (!rule && (!baseline || baseline.requiresAuth !== true)) {
      return this.applyDefaultPolicy(user);
    }

    // 4. Requisito EFFETTIVO: il più stretto fra la regola e il baseline (D4,
    //    monotonia). Una regola può solo stringere; se allenta, vince il baseline —
    //    e il tentativo è già stato segnalato al caricamento.
    const effective = tightenAccess(
      rule || { requiresAuth: false, allowedRoles: [] },
      baseline
    );

    // 5. Verifica autenticazione
    if (effective.requiresAuth && !user) {
      return {
        allowed: false,
        redirect: this.defaultPolicy.redirectOnDenied,
        status: null, // Redirect, non status code
        reason: rule ? 'Authentication required' : `Authentication required (zone "${zone.name}" baseline)`
      };
    }

    // 6. Verifica ruoli
    if (effective.requiresAuth && effective.allowedRoles && effective.allowedRoles.length > 0) {
      // Gestisci sia roleIds (array) che roleId (singolo) per backward compatibility
      const userRoles = user.roleIds ||
                        (user.roleId !== undefined ? [user.roleId] : []);
      const hasRequiredRole = userRoles.some(roleId => effective.allowedRoles.includes(roleId));

      if (!hasRequiredRole) {
        // Utente autenticato ma senza ruolo necessario → 403 o redirect custom
        return {
          allowed: false,
          redirect: '/pluginPages/adminAccessControl/access-denied.ejs', // Pagina custom
          status: null,
          reason: `Required roles: ${effective.allowedRoles.join(', ')}, user has: ${userRoles.join(', ')}`
        };
      }
    }

    // 7. Accesso consentito
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
      // LAYER A (OBBLIGATORIO) — canonicalizza il path PRIMA del match, così la
      // guardia decide sulla stessa forma con cui il file server statico risolve
      // il file. Chiude il bypass via path non canonico (`/./admin/...`,
      // `/x/../admin/...`, `//admin/...`) indipendentemente dal gate opzionale B
      // (rejectNonCanonicalPaths). Vedi core/pathCanonicalizer.js.
      let url = canonicalizePath(ctx.path);

      // Normalizza il path togliendo il globalPrefix prima del match: i pattern in
      // accessControl.json5 sono logici (senza prefix), così funzionano identici con
      // o senza deploy-prefix. Senza globalPrefix è un no-op.
      const gp = this.globalPrefix;
      if (gp && (url === gp || url.startsWith(gp + '/'))) {
        url = url.slice(gp.length) || '/';
      }
      const user = ctx.session?.user || null;

      // ── Superficie riservata chiusa (CLI: `reserved stop`) ──
      // Terzo punto di enforcement, quello delle PAGINE: le rotte API le chiude il
      // route-wrap di pluginSys, i due prefissi admin li chiude il gate stesso,
      // ma le pagine servite staticamente (userProfile.ejs, login.ejs) passano
      // solo di qui, perché cadono oltre il router.
      //
      // Va PRIMA di checkAccess: altrimenti una pagina riservata risponderebbe
      // con un redirect verso il login — che a superficie chiusa è a sua volta un
      // 404. Un 302 verso il nulla è insieme brutto e rivelatore.
      const reservedGate = typeof this.pluginSys?.getReservedGate === 'function'
        ? this.pluginSys.getReservedGate()
        : null;
      if (reservedGate && reservedGate.isClosed()) {
        const reservedRule = this.patternMatcher.findMatchingRule(url, this.rules);
        if (reservedRule && (reservedRule.requiresAuth || reservedRule.isAuthEntryPoint)) {
          reservedGate.deny(ctx);
          return;
        }
      }

      // Verifica accesso
      const accessResult = this.checkAccess(url, user);

      if (!accessResult.allowed) {
        // Accesso negato

        // Log per debugging
        console.log(`[AccessControl] Access denied: ${ctx.path} - ${accessResult.reason}`);

        // Redirect (per utenti non autenticati) — prefissato col globalPrefix
        // perché punta a una pagina interna (es. login).
        if (accessResult.redirect) {
          ctx.redirect((this.globalPrefix || '') + accessResult.redirect);
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

    // Verifica autenticazione (redirect prefissato col globalPrefix)
    if (requirements.requiresAuth && !user) {
      ctx.redirect((this.globalPrefix || '') + this.defaultPolicy.redirectOnDenied);
      return;
    }

    // Verifica ruoli
    if (requirements.allowedRoles && requirements.allowedRoles.length > 0) {
      // Gestisci sia roleIds (array) che roleId (singolo) per backward compatibility
      const userRoles = user?.roleIds ||
                        (user?.roleId !== undefined ? [user.roleId] : []);
      const hasRequiredRole = userRoles.some(roleId => requirements.allowedRoles.includes(roleId));

      if (!hasRequiredRole) {
        ctx.redirect((this.globalPrefix || '') + '/pluginPages/adminAccessControl/access-denied.ejs');
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
   * @param {string} jsonString - Stringa JSON5 completa (già validata)
   * @returns {object} - { success: boolean, error: string|null }
   */
  saveRules(jsonString) {
    try {
      const fs = require('fs');
      const configPath = path.join(this.pathPluginFolder, 'accessControl.json5');

      // Scrivi file (con backup temporaneo)
      // Salva la stringa JSON5 originale per preservare commenti e formattazione
      const tempPath = configPath + '.tmp';
      fs.writeFileSync(tempPath, jsonString, 'utf8');
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
