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
const {
  checkAccessInvariants,
  formatAccessProblemsBox,
} = require('../../../core/accessInvariantCheck');
const path = require('path');

/** Le tre azioni che `applyDefaultPolicy` sa applicare. */
const DEFAULT_POLICY_ACTIONS = Object.freeze(['allow', 'deny', 'requireAuth']);

/**
 * La `defaultPolicy` dichiarata è usabile? Ritorna il difetto, o `null`.
 *
 * Serve a DUE percorsi (il caricamento e la validazione di un candidato), quindi sta
 * qui una volta sola. Ricalca `describePrefixDefect` di `core/pathZoneResolver.js`.
 *
 * Perché è un controllo e non una tolleranza:
 *   • `redirectOnDenied` assente → un rifiuto per autenticazione non porta né
 *     redirect né status, e fino alla revisione della Fase 3 il middleware lo
 *     serviva. Ora lo nega con 403, ma la causa va detta: senza questo controllo la
 *     diagnosi era un `TypeError` su `undefined` dentro il messaggio della sonda.
 *   • `action` ignota → il `default:` di `applyDefaultPolicy` ricade su « allow ».
 *     Un refuso (`"alow"`, `"Deny"`) renderebbe quindi PUBBLICO un sito che
 *     l'amministratore ha scritto per essere chiuso, in silenzio.
 */
function describeDefaultPolicyDefect(policy) {
  if (policy === undefined || policy === null) {
    return 'la chiave `defaultPolicy` manca: senza di essa un rifiuto non ha un esito su cui agire';
  }
  if (typeof policy !== 'object' || Array.isArray(policy)) {
    return '`defaultPolicy` non è un oggetto';
  }
  if (!DEFAULT_POLICY_ACTIONS.includes(policy.action)) {
    return `\`defaultPolicy.action\` vale ${JSON.stringify(policy.action)}, che non è fra `
      + `${DEFAULT_POLICY_ACTIONS.join(' | ')}: verrebbe trattata come "allow"`;
  }
  if (typeof policy.redirectOnDenied !== 'string' || policy.redirectOnDenied.trim() === '') {
    return '`defaultPolicy.redirectOnDenied` manca o è vuota: un rifiuto per autenticazione '
      + 'non porterebbe alcun esito applicabile';
  }
  return null;
}

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

    // Problemi rilevati al caricamento del ruleset: risoluzione, collisioni,
    // violazioni del baseline, e le invarianti (le sonde). Al BOOT un problema è
    // fatale; a runtime il ruleset nuovo è rifiutato e resta in vigore il vecchio.
    this.rulesetProblems = [];

    // Il primo `loadRules()` è quello del boot. Serve a distinguere i due
    // comportamenti di D7: al boot si lancia (e `pluginSys`, per cui questo plugin
    // è `essential`, fa `[FATAL]` + exit), a runtime si rifiuta tenendo il vecchio.
    this.bootCompleted = false;

    // Carica regole all'inizializzazione. Se qui qualcosa non torna, `loadRules`
    // LANCIA: `pluginSys` lo tratta come fallimento di un `essentialPlugin` →
    // `[FATAL]` + exit. Vedi #reportProblems.
    this.loadRules();

    // Da qui in avanti ogni ricarica è « a runtime »: rifiuta e conserva.
    this.bootCompleted = true;
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

      // ⚠ NIENTE viene assegnato a `this` finché i controlli non sono passati.
      // A runtime un candidato rifiutato deve lasciare in vigore il ruleset
      // PRECEDENTE (D7): committare prima e rifiutare dopo lo avrebbe già distrutto,
      // ottenendo l'opposto di ciò che la regola vuole — un sito con MENO protezioni
      // di quelle che aveva un istante prima.
      const candidate = {
        rules: resolved.rules,
        pathZones: this.pathZones,
        defaultPolicy: config.defaultPolicy,
      };

      // La forma della `defaultPolicy` va controllata PRIMA delle sonde: altrimenti
      // una chiave mancante arriva a `checkAccess`, che dereferenzia `undefined`, e
      // la diagnosi finale è un `TypeError` interno invece della causa.
      const policyDefect = describeDefaultPolicyDefect(config.defaultPolicy);
      const policyProblems = policyDefect
        ? [{ kind: 'default-policy-invalid', detail: policyDefect }]
        : [];

      // Le INVARIANTI: non si guarda com'è scritto il file, si guarda cosa
      // risponderebbe il sistema. Le sonde girano sul CANDIDATO, non sul ruleset
      // vivo — che a runtime è ancora il precedente, cioè proprio quello che non
      // vogliamo misurare.
      // Le sonde girano SOLO se la policy è usabile: contro una policy difettosa non
      // potrebbero dare un verdetto sensato, e aggiungerebbero diciannove righe di
      // rumore sopra l'unico messaggio che spiega la causa. Un problema chiaro vale
      // più di venti accurati — è il criterio deciso per il box `[ACCESS]`.
      const invariants = policyDefect
        ? { problems: [], probed: 0 }
        : checkAccessInvariants(
          (url, user) => this.checkAccess(url, user, candidate),
          this.pathZones,
          { loginUrl: candidate.defaultPolicy.redirectOnDenied }
        );

      const problems = [
        ...this.pathZones.problems,
        ...policyProblems,
        ...resolved.problems,
        ...invariants.problems,
      ];

      if (problems.length > 0) {
        // Al boot lancia; a runtime stampa e si esce da qui senza committare.
        this.#reportProblems(problems);
        console.warn('[AccessManager] ruleset candidato SCARTATO: resta in vigore il precedente'
          + ` (${this.rules ? Object.keys(this.rules).length : 0} pattern)`);
        return { accepted: false, problems };
      }

      // Controlli superati: adesso si committa.
      this.rules = candidate.rules;
      this.defaultPolicy = candidate.defaultPolicy;
      this.rulesetProblems = [];

      console.log(`[AccessManager] Rules loaded: ${Object.keys(this.rules).length} patterns`
        + (resolved.derived.length > 0 ? ` (${resolved.derived.length} derivate da hideExtension)` : '')
        + ` · ${invariants.probed} invarianti verificate`);

      return { accepted: true, problems: [] };
    } catch (err) {
      // Un problema delle invarianti non è un errore di lettura: va rilanciato così
      // com'è, altrimenti il fallback qui sotto lo trasformerebbe in « file
      // illeggibile » e il boot proseguirebbe con zero regole.
      if (err && err.ital8AccessProblems) throw err;

      console.error('[AccessManager] Failed to load accessControl.json5', err);

      // Fallback: nessuna regola — e solo al BOOT, perché a runtime un file
      // diventato illeggibile non deve far perdere il ruleset che sta funzionando.
      if (this.bootCompleted) {
        console.warn('[AccessManager] file illeggibile: resta in vigore il ruleset precedente');
        return { accepted: false, problems: [{ kind: 'config-unreadable', detail: err.message }] };
      }

      // NON è più un fallback aperto: il `baseline` delle zone chiuse vive in codice
      // (`core/pathZoneResolver.js`), quindi con zero regole il pannello admin resta
      // comunque protetto. È il punto dell'intera decisione — prima di essa un
      // accessControl.json5 illeggibile apriva il pannello a chiunque.
      this.rules = {};
      this.defaultPolicy = { action: 'allow', redirectOnDenied: '/pluginPages/adminUsers/login.ejs' };
      this.rulesetProblems = [{ kind: 'config-unreadable', detail: err.message }];
      return { accepted: false, problems: this.rulesetProblems };
    }
  }

  /**
   * Verifica un ruleset CANDIDATO — una stringa JSON5 non ancora su disco — con gli
   * stessi controlli che girano al boot: risoluzione dei segnaposti, collisioni,
   * monotonia del `baseline`, e le invarianti (le sonde).
   *
   * Non tocca `this.rules`: la valutazione gira contro il candidato grazie al terzo
   * parametro di `checkAccess`. Senza di esso si potrebbe sondare solo il ruleset
   * già in vigore, cioè accorgersi del guasto dopo averlo installato.
   *
   * @param {string} jsonString - Contenuto JSON5 proposto.
   * @returns {{valid: boolean, problems: object[]}}
   */
  validateCandidate(jsonString) {
    let parsed;
    try {
      parsed = require('json5').parse(jsonString);
    } catch (err) {
      return { valid: false, problems: [{ kind: 'json5-syntax', detail: err.message }] };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { valid: false, problems: [{ kind: 'json5-syntax', detail: 'il contenuto non è un oggetto' }] };
    }

    const declared = { ...parsed.customRules, ...parsed.hardcodedRules };

    // ⚠ NESSUN fallback sullo stato vivo. Prima si ricadeva su `this.defaultPolicy`
    // quando il candidato non la dichiarava: così si validava una configurazione
    // DIVERSA da quella che si stava per scrivere, e un file privo di
    // `defaultPolicy` passava il controllo per poi non far partire il CMS al riavvio
    // successivo — cioè esattamente « un file che non farebbe ripartire il CMS » che
    // veniva salvato. Si valida ciò che finirebbe su disco, e nient'altro.
    const defaultPolicy = parsed.defaultPolicy;
    const policyDefect = describeDefaultPolicyDefect(defaultPolicy);
    if (policyDefect) {
      return { valid: false, problems: [{ kind: 'default-policy-invalid', detail: policyDefect }] };
    }

    let resolved;
    try {
      resolved = resolveRuleset(declared, this.pathZones);
    } catch (err) {
      return { valid: false, problems: [{ kind: 'ruleset-unusable', detail: err.message }] };
    }

    const candidate = { rules: resolved.rules, pathZones: this.pathZones, defaultPolicy };
    const invariants = checkAccessInvariants(
      (url, user) => this.checkAccess(url, user, candidate),
      this.pathZones,
      { loginUrl: defaultPolicy && defaultPolicy.redirectOnDenied }
    );

    const problems = [...resolved.problems, ...invariants.problems];
    return { valid: problems.length === 0, problems };
  }

  /**
   * Stampa il box `[ACCESS]` e applica il comportamento asimmetrico di D7.
   *
   * Al BOOT **lancia**, invece di chiamare `process.exit`: la fatalità appartiene a
   * `pluginSys`, che per un plugin in `essentialPlugins` emette `[FATAL]` e termina.
   * Un `process.exit` da dentro un plugin scavalcherebbe quella macchina e
   * ignorerebbe una dichiarazione del maintainer. Il rovescio — se qualcuno togliesse
   * `adminAccessControl` da `essentialPlugins` il plugin verrebbe solo saltato, e il
   * sito servito senza guardia — è presidiato da un test, non da questo codice.
   *
   * A RUNTIME non lancia: il chiamante (`reloadRules`/`saveRules`) scarta il
   * candidato e tiene in vigore il ruleset precedente.
   * @private
   */
  #reportProblems(problems) {
    const rulesFile = path.join(this.pathPluginFolder, 'accessControl.json5');
    const fatal = !this.bootCompleted;

    // `rulesetProblems` descrive la configurazione IN VIGORE. A runtime un candidato
    // rifiutato non entra in vigore, quindi i suoi problemi non vanno scritti qui:
    // lo stato direbbe « la configurazione attiva ha problemi » mentre quella attiva
    // è sana. Chi ha chiesto la ricarica li riceve nel valore di ritorno.
    if (fatal) this.rulesetProblems = problems;

    const box = formatAccessProblemsBox(problems, { fatal, rulesFile });
    const emit = fatal ? console.error : console.warn;
    for (const line of box) emit(line);

    if (fatal) {
      const err = new Error(
        `[adminAccessControl] controllo accessi non applicabile: `
        + `${problems.length} problemi (vedi il box [ACCESS] sopra)`
      );
      err.ital8AccessProblems = problems;
      throw err;
    }
  }

  /**
   * Reload regole (chiamato quando admin salva modifiche)
   */
  reloadRules() {
    console.log('[AccessManager] Reloading rules...');
    // L'esito va PROPAGATO: dopo la Fase 3 una ricarica può essere rifiutata, e chi
    // l'ha chiesta deve poterlo sapere invece di presumere che sia andata.
    return this.loadRules();
  }

  /**
   * Verifica se un utente può accedere a un URL
   * @param {string} url - URL richiesto
   * @param {object} user - Oggetto user da ctx.session.user (o null se non autenticato)
   * @returns {object} - { allowed: boolean, redirect: string|null, status: number|null, reason: string }
   */
  checkAccess(url, user = null, context = null) {
    // `context` permette di valutare la decisione contro un ruleset DATO invece che
    // contro quello vivo. Serve a due cose che prima erano impossibili:
    //   • sondare un ruleset CANDIDATO prima di scriverlo su disco (vedi saveRules),
    //     così un file che non farebbe ripartire il CMS non può essere salvato;
    //   • testare la logica di decisione senza istanziare un manager né toccare il
    //     filesystem.
    // Senza di esso le sonde potrebbero misurare solo il ruleset già in vigore —
    // cioè accorgersi del guasto dopo averlo installato.
    const rules = context ? context.rules : this.rules;
    const pathZones = context ? context.pathZones : this.pathZones;
    const defaultPolicy = context ? context.defaultPolicy : this.defaultPolicy;

    // 1. Trova regola matching
    const rule = this.patternMatcher.findMatchingRule(url, rules);

    // 2. Il `baseline` della ZONA a cui la URL appartiene (D3).
    //
    // La zona si ricava dalla URL RICHIESTA, non dal pattern: così il minimo
    // d'accesso vale anche dove il controllo al caricamento non arriva (una regola
    // `regex:`, di cui non si sa la zona leggendone il testo).
    const zone = zoneForPath(url, pathZones.zones);
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
      return this.applyDefaultPolicy(user, defaultPolicy);
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
        redirect: defaultPolicy.redirectOnDenied,
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
  applyDefaultPolicy(user, defaultPolicy = null) {
    const policy = defaultPolicy || this.defaultPolicy;
    switch (policy.action) {
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
            redirect: policy.redirectOnDenied,
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

        // ⚠ FAIL-OPEN CHIUSO QUI. Fino alla revisione della Fase 3 un rifiuto che
        // non portava né redirect né status cadeva fuori da questo `if` e finiva su
        // `await next()`: la pagina veniva SERVITA a chi era stato negato.
        //
        // Era raggiungibile con una configurazione plausibile — `defaultPolicy:
        // { action: "allow" }` senza `redirectOnDenied` — e su OGNI URL di zona
        // chiusa priva di regola. Misurato: `checkAccess` rispondeva
        // `{allowed: false, redirect: undefined, status: null}` e la pagina usciva.
        //
        // Un rifiuto senza esito applicabile è un difetto di configurazione, non
        // un permesso: qui si nega e si dice che è successo. La causa vera è
        // segnalata al caricamento (problema `default-policy-invalid`), questo è il
        // presidio di ultima istanza perché `allowed: false` non possa MAI
        // significare « servi la pagina ».
        console.error('[AccessControl] rifiuto senza esito applicabile su '
          + `${ctx.path} (${accessResult.reason}) — negato con 403. `
          + 'Causa tipica: defaultPolicy priva di redirectOnDenied.');
        ctx.status = 403;
        ctx.body = { error: 'Access Denied', reason: accessResult.reason };
        return;
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

      // ── Gli STESSI controlli del boot, PRIMA di scrivere ──────────────────
      //
      // `saveRules` è il punto unico da cui passa ogni scrittura, quindi è qui che
      // va il presidio. Senza, la sequenza era: valida (col validatore della GUI,
      // che non conosce zone né segnaposti) → SCRIVE → ricarica → la ricarica
      // rifiuta → la GUI dice « salvato » → al riavvio successivo il CMS non parte.
      // Un salvataggio apparentemente riuscito che spegne il sito dopo.
      //
      // L'invariante che si ottiene: un file che non farebbe ripartire il CMS non
      // può essere salvato.
      //
      // I due validatori NON si sostituiscono: `ruleValidator.validateFromUI`
      // (sintassi JSON5, immutabilità delle hardcoded, esistenza dei ruoli,
      // conflitti con le rotte dei plugin) resta dove sta e conserva il suo
      // mestiere; questo aggiunge ciò che solo il motore sa. Un predicato
      // condiviso fra due percorsi, non due validatori che devono concordare —
      // il progetto ha già visto divergere validatore e dispatcher su `access`.
      const verdict = this.validateCandidate(jsonString);
      if (!verdict.valid) {
        return {
          success: false,
          error: 'Il ruleset proposto non supera i controlli del controllo accessi: '
            + 'il file NON è stato modificato.',
          problems: verdict.problems,
        };
      }

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
