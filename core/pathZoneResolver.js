/**
 * pathZoneResolver — la mappa dello spazio URL (`pathZones`) e la risoluzione dei
 * segnaposti di percorso (`pathPlaceholder`) nei pattern dei file di configurazione.
 *
 * Modulo **puro**: nessun I/O, nessun filesystem, nessun logger, nessun `process.exit`.
 * Riceve `ital8Conf` già caricato e restituisce dati più diagnostiche. Gemello di
 * `core/pluginStateResolver.js` e `core/pluginLoadOrder.js` per forma e contratto:
 * **riporta, non decide.** La fatalità al boot e il rifiuto a runtime vivono nel
 * chiamante (vedi D7 della decisione), non qui.
 *
 * → Decisione: `docs/decisions/path-zones.it.md`
 *
 * ─── PERCHÉ ESISTE ───────────────────────────────────────────────────────────
 * Lo spazio URL di ital8cms è governato da sette prefissi **configurabili**
 * (`globalPrefix`, `apiPrefix`, `adminPrefix`, `pluginPagesPrefix`, `viewsPrefix`,
 * `publicThemeResourcesPrefix`, `adminThemeResourcesPrefix`) più « tutto il resto »,
 * cioè il sito. Ma i file di configurazione che contengono pattern di URL scrivono
 * quei prefissi **a mano, come testo**: 20 letterali censiti in 4 file
 * (`accessControl` 11, `sentinelRules` 6, `seoPages` 2, `protectedRoutes` 1), e 8
 * moduli che consumano `core/patternMatcher.js`.
 *
 * MISURATO: la protezione del pannello admin è scritta `"/admin"` e `"/admin/**"` in
 * `plugins/adminAccessControl/accessControl.default.json5`, mentre la posizione reale
 * del pannello è `adminPrefix`. Nessun codice sincronizzava le due cose — `adminPrefix`
 * non compariva in NESSUN `.js` del plugin. Con `adminPrefix: "backoffice"` il matcher
 * reale restituisce `null` su `/backoffice/index.ejs`, quindi si applica la
 * `defaultPolicy` (`allow`) e le pagine admin sono servite a un anonimo. È il difetto
 * A1 di `REVIEW.md`, e questo modulo ne rimuove la causa invece del sintomo.
 *
 * ─── LE ZONE ─────────────────────────────────────────────────────────────────
 * Sette zone, ognuna con quattro attributi che prima vivevano in quattro posti diversi:
 *
 *   zona                   prefisso da                   estensione da              baseline
 *   ─────────────────────  ────────────────────────────  ─────────────────────────  ──────────────────
 *   admin                  adminPrefix                   hideExtension.adminPrefix  chiuso [0,1]
 *   adminThemeResources    adminThemeResourcesPrefix      —                          chiuso [0,1]
 *   views                  viewsPrefix                    —                          chiuso [0,1]
 *   api                    apiPrefix                      —                          DELEGATO (null)
 *   pluginPages            pluginPagesPrefix              hideExtension.pluginPagesPrefix  aperto
 *   publicThemeResources   publicThemeResourcesPrefix     —                          aperto
 *   site  (zona di default)  — (tutto il resto)           hideExtension.wwwPath      aperto
 *
 * `globalPrefix` **non è una zona**: è il prefisso di deploy che precede tutte le zone
 * e viene rimosso dal path prima del confronto (come già fa `accessManager`). I pattern
 * sono quindi *logici*, senza deploy-prefix — ed è il motivo per cui questo modulo non
 * lo conosce affatto.
 *
 * `api` ha `baseline: null` perché il suo controllo d'accesso NON passa da qui: una
 * rotta che matcha termina la catena nel router (`index.js:147` monta i priority
 * middleware, `:350` quelli dei plugin, e `pluginSys.#wrapHandlerWithAccessCheck` non
 * riceve `next`), quindi il campo `access` della rotta decide da solo.
 *
 * ─── IL CONTRATTO FAIL-CLOSED ────────────────────────────────────────────────
 * Un segnaposto che non si risolve **non diventa mai un letterale**. È la ragione per
 * cui la proposta iniziale (`"ital8Conf.adminPrefix/**"`, senza delimitatori) è stata
 * scartata: non iniziando con `/` sarebbe rimasta una stringa che non matcha nessun
 * URL, cioè « nessuna regola » → `defaultPolicy: allow` → A1 di nuovo, stavolta in una
 * forma che *sembra* corretta a chi legge il file.
 *
 * Qui invece un pattern con un problema viene **scartato** dal ruleset risultante e il
 * problema è riportato al chiamante. Un pattern mai registrato non protegge nulla, ma
 * non finge nemmeno di farlo: il chiamante lo trasforma in un errore fatale al boot.
 *
 * ─── PERCHÉ AL CARICAMENTO E NON PER RICHIESTA ───────────────────────────────
 * Vincolo tecnico, non scelta di stile: `patternMatcher.getPatternInfo()` classifica
 * tipo e priorità **dalla stringa grezza** (`regex:` → 500, `**` → 100, …). Risolvere
 * al momento del match significherebbe classificare la stringa sbagliata. Risolvendo
 * una volta a `loadRules()` il costo a runtime è zero.
 *
 * @module core/pathZoneResolver
 */

'use strict';

// ─── Definizione delle zone ──────────────────────────────────────────────────
//
// `prefixKey`       chiave di ital8Config da cui viene il prefisso concreto
// `fallback`        valore documentato, usato quando la chiave manca o è vuota
//                   (stessa logica di runtimeGate.js:60 — `ital8Conf.adminPrefix || 'admin'`)
// `hideExtensionKey` contesto di `hideExtension` che governa questa zona, o null
// `baseline`        minimo d'accesso della zona: le regole possono solo STRINGERLO (D4).
//                   Volutamente nella stessa forma delle regole (`requiresAuth` /
//                   `allowedRoles`), così la monotonia è un confronto fra oggetti
//                   omogenei invece di una traduzione. `null` = delegato altrove.
const ZONE_DEFINITIONS = Object.freeze([
  {
    name: 'admin',
    prefixKey: 'adminPrefix',
    fallback: 'admin',
    hideExtensionKey: 'adminPrefix',
    baseline: { requiresAuth: true, allowedRoles: [0, 1] },
  },
  {
    name: 'adminThemeResources',
    prefixKey: 'adminThemeResourcesPrefix',
    fallback: 'admin-theme-resources',
    hideExtensionKey: null,
    baseline: { requiresAuth: true, allowedRoles: [0, 1] },
  },
  {
    name: 'views',
    prefixKey: 'viewsPrefix',
    fallback: 'views',
    hideExtensionKey: null,
    baseline: { requiresAuth: true, allowedRoles: [0, 1] },
  },
  {
    name: 'api',
    prefixKey: 'apiPrefix',
    fallback: 'api',
    hideExtensionKey: null,
    baseline: null, // delegato al route-wrap di pluginSys
  },
  {
    name: 'pluginPages',
    prefixKey: 'pluginPagesPrefix',
    fallback: 'pluginPages',
    hideExtensionKey: 'pluginPagesPrefix',
    baseline: { requiresAuth: false, allowedRoles: [] },
  },
  {
    name: 'publicThemeResources',
    prefixKey: 'publicThemeResourcesPrefix',
    fallback: 'public-theme-resources',
    hideExtensionKey: null,
    baseline: { requiresAuth: false, allowedRoles: [] },
  },
  {
    // Zona di DEFAULT: non ha un prefisso proprio, è « tutto ciò che non ricade
    // nelle altre sei ». È anche il motivo per cui i segnaposti portano il nome
    // della ZONA e non quello della chiave di config: `site` non ha nessun
    // `sitePrefix`, quindi lo schema « nome della chiave » non coprirebbe tutte
    // le zone. Vedi D2 della decisione.
    name: 'site',
    prefixKey: null,
    fallback: null,
    hideExtensionKey: 'wwwPath',
    baseline: { requiresAuth: false, allowedRoles: [] },
  },
]);

/** I nomi di zona ammessi nei segnaposti. Vocabolario CHIUSO (D2). */
const ZONE_NAMES = Object.freeze(ZONE_DEFINITIONS.map((z) => z.name));

/**
 * Segnaposto: `{{nomeZona}}`. Lo spazio interno è tollerato (`{{ admin }}`) perché
 * è un refuso innocuo; un nome SCONOSCIUTO no, quello è un problema riportato.
 */
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\s*\}\}/g;

/** Prefisso che `patternMatcher` usa per i pattern regex. */
const REGEX_PREFIX = 'regex:';

// ─── Helper interni ──────────────────────────────────────────────────────────

/**
 * Normalizza un valore di prefisso preso dal config in un prefisso di URL.
 * `'admin'`, `'/admin'`, `'admin/'`, `'/admin/'` → `'/admin'`. Vuoto → `''`.
 */
function normalizePrefix(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed === '' ? '' : `/${trimmed}`;
}

/**
 * Confronto per SEGMENTI, non per stringa: `/administrator` NON sta sotto `/admin`.
 * Replica esatta di `pathIsUnderSegment` in `core/priorityMiddlewares/runtimeGate.js`,
 * così la Fase 6 può consolidare i due senza cambiare comportamento.
 */
function pathIsUnderSegment(candidate, prefix) {
  return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

/** Serializzazione stabile (chiavi ordinate) per confrontare due regole. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Due regole sono « la stessa »? `derivedFrom` è metadato di questo modulo, non
 * contenuto della regola, quindi non partecipa al confronto.
 */
function sameRule(a, b) {
  const strip = (r) => {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) return r;
    const { derivedFrom: _ignored, ...rest } = r;
    return rest;
  };
  return stableStringify(strip(a)) === stableStringify(strip(b));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalizza un suffisso di estensione nella forma canonica col punto.
 *
 * Replica la semantica di `normalizeExtSuffix` in `koa-classic-server/index.cjs:30`,
 * che è il modulo che SERVE davvero le URL pulite: lì il punto iniziale è
 * « decorazione opzionale » (`'ejs'` ≡ `'.ejs'`) e i suffissi composti
 * (`'.tar.gz'`, `'.html.ejs'`) sono di prima classe, perché il match è per SUFFISSO.
 *
 * Senza questa normalizzazione un `ext: 'ejs'` (accettato dal server) ci farebbe
 * derivare `/admin/secret.` invece di `/admin/secret`: la URL pulita che il server
 * serve davvero non matcherebbe nessuna regola, e in silenzio.
 *
 * @returns {string|null} forma canonica col punto, o `null` se non nomina un suffisso.
 */
function normalizeExtSuffix(value) {
  if (typeof value !== 'string') return null;
  const stripped = value.startsWith('.') ? value.slice(1) : value;
  if (stripped === '') return null;
  return `.${stripped}`;
}

/**
 * Un prefisso concreto finisce DENTRO un pattern, quindi i metacaratteri del
 * matcher lo tradiscono: `adminPrefix: "a*b"` produce `/a*b/**`, che
 * `patternMatcher` compila in `^/a[^/]+b/.*$` — e `/a*b/index.ejs` (il path
 * letterale che il server serve) NON matcha. La zona resterebbe scoperta in
 * silenzio, cioè il difetto A1 per un'altra strada.
 *
 * Lo spazio bianco non espone (viene matchato letteralmente) ma rende il pattern
 * invalido secondo `patternMatcher.validatePattern()`: incoerenza che va detta.
 *
 * MISURATO: `*` scopre la zona; `?` e lo spazio no. La GUI valida `adminPrefix` e
 * `apiPrefix` (`/^[a-zA-Z0-9_-]+$/` in `plugins/admin/systemSettings.js:104`) ma
 * NON `viewsPrefix`, e un `ital8Config.json5` scritto a mano non passa da nessun
 * validatore: il presidio va quindi nel punto d'uso, qui.
 */
function describePrefixDefect(prefix) {
  if (/[*]/.test(prefix)) return 'contiene il metacarattere * — la zona NON verrebbe intercettata';
  if (/\s/.test(prefix)) return 'contiene spazi — patternMatcher.validatePattern() rifiuta il pattern risultante';
  return null;
}

// ─── API pubblica ────────────────────────────────────────────────────────────

/**
 * Costruisce la mappa delle zone leggendo i prefissi concreti da `ital8Conf`.
 *
 * Le zone sono ordinate per **lunghezza di prefisso decrescente**, così
 * `zoneForPath` può fare longest-match scorrendole in ordine; `site`, che ha
 * prefisso vuoto, resta per costruzione l'ultima e fa da catch-all.
 *
 * @param {object} ital8Conf - Configurazione globale già caricata (`loadJson5`).
 * @returns {{zones: object[], byName: Map<string, object>, site: object, problems: object[]}}
 *   `problems` riporta le zone che collidono su uno stesso prefisso concreto — una
 *   misconfigurazione (es. `adminPrefix: "api"`) che altrimenti farebbe sparire una
 *   zona dentro l'altra senza un fiato.
 * @throws {TypeError} se `ital8Conf` non è un oggetto (errore del chiamante).
 */
function resolvePathZones(ital8Conf) {
  if (!isPlainObject(ital8Conf)) {
    throw new TypeError('resolvePathZones: ital8Conf must be an object');
  }

  const hideExtension = isPlainObject(ital8Conf.hideExtension) ? ital8Conf.hideExtension : {};

  const zones = ZONE_DEFINITIONS.map((def) => {
    // Prefisso concreto. Una chiave assente o vuota ricade sul valore documentato,
    // non su stringa vuota: un prefisso vuoto farebbe coincidere la zona con la
    // radice del sito e la renderebbe un secondo catch-all.
    let prefix = '';
    if (def.prefixKey) {
      prefix = normalizePrefix(ital8Conf[def.prefixKey]) || normalizePrefix(def.fallback);
    }

    // Estensione ATTIVA in questa zona: valorizzata solo se `hideExtension` è
    // acceso per il suo contesto, perché è l'unico caso in cui una forma senza
    // estensione esiste davvero come URL servito (D5).
    let ext = null;
    if (def.hideExtensionKey) {
      const ctx = hideExtension[def.hideExtensionKey];
      if (isPlainObject(ctx) && ctx.enabled === true) {
        ext = normalizeExtSuffix(ctx.ext);
      }
    }

    return Object.freeze({
      name: def.name,
      prefix,
      prefixKey: def.prefixKey,
      ext,
      hideExtensionKey: def.hideExtensionKey,
      baseline: def.baseline === null ? null : Object.freeze({
        requiresAuth: def.baseline.requiresAuth,
        allowedRoles: Object.freeze([...def.baseline.allowedRoles]),
      }),
    });
  });

  const problems = [];
  const named = zones.filter((z) => z.prefix !== ''); // `site` non ha prefisso proprio

  // Prefisso che il matcher non può rappresentare fedelmente.
  for (const zone of named) {
    const defect = describePrefixDefect(zone.prefix);
    if (defect) {
      problems.push(Object.freeze({
        kind: 'zone-prefix-invalid',
        zone: zone.name,
        key: zone.prefixKey,
        prefix: zone.prefix,
        detail: defect,
      }));
    }
  }

  // Collisione fra zone: non solo prefissi IDENTICI ma anche ANNIDATI.
  // `adminPrefix: "admin"` + `apiPrefix: "admin/api"` passavano in silenzio, e il
  // longest-match consegnava quel sottoalbero del pannello alla zona `api`, il cui
  // baseline è `null`: un pezzo di area riservata senza minimo d'accesso.
  for (let i = 0; i < named.length; i += 1) {
    for (let j = i + 1; j < named.length; j += 1) {
      const a = named[i];
      const b = named[j];
      const identical = a.prefix === b.prefix;
      const nested = pathIsUnderSegment(a.prefix, b.prefix) || pathIsUnderSegment(b.prefix, a.prefix);
      if (!identical && !nested) continue;
      problems.push(Object.freeze({
        kind: 'zone-prefix-collision',
        prefix: identical ? a.prefix : undefined,
        prefixes: Object.freeze([a.prefix, b.prefix]),
        zones: Object.freeze([a.name, b.name]),
        keys: Object.freeze([a.prefixKey, b.prefixKey]),
        detail: identical
          ? 'due zone condividono lo stesso prefisso concreto'
          : 'una zona è ANNIDATA nell\'altra: il longest-match consegna il sottoalbero alla più profonda',
      }));
    }
  }

  const ordered = Object.freeze(
    [...zones].sort((a, b) => b.prefix.length - a.prefix.length || a.name.localeCompare(b.name))
  );

  return {
    zones: ordered,
    byName: new Map(zones.map((z) => [z.name, z])),
    site: zones.find((z) => z.name === 'site'),
    problems: Object.freeze(problems),
  };
}

/**
 * A quale zona appartiene un path (o un pattern già risolto)?
 *
 * Longest-match **per segmenti**: `/administrator` non sta sotto `/admin`. Un pattern
 * `regex:` restituisce `null`, perché la zona di una regex non è determinabile
 * guardandone il testo — ed è anche il motivo per cui le regex non ricevono la
 * derivazione dell'estensione.
 *
 * @param {string} pathOrPattern - Path logico (senza `globalPrefix`) o pattern risolto.
 * @param {object[]} zones - `zones` di `resolvePathZones` (ordinate).
 * @returns {object|null} Il record di zona, oppure `null` per i pattern `regex:`.
 * @throws {TypeError} se gli argomenti non hanno il tipo atteso.
 */
function zoneForPath(pathOrPattern, zones) {
  if (typeof pathOrPattern !== 'string') {
    throw new TypeError('zoneForPath: pathOrPattern must be a string');
  }
  if (!Array.isArray(zones)) {
    throw new TypeError('zoneForPath: zones must be an array');
  }
  if (pathOrPattern.startsWith(REGEX_PREFIX)) return null;

  let fallbackZone = null;
  for (const zone of zones) {
    if (zone.prefix === '') { fallbackZone = zone; continue; }
    if (pathIsUnderSegment(pathOrPattern, zone.prefix)) return zone;
  }
  return fallbackZone;
}

/**
 * Risolve i segnaposti di UN pattern.
 *
 * @param {string} pattern - Pattern grezzo, con o senza segnaposti.
 * @param {Map<string, object>|object} zonesByName - `byName` di `resolvePathZones`.
 * @returns {{pattern: string|null, problems: object[]}}
 *   `pattern: null` quando c'è un problema: il chiamante NON deve registrarlo.
 *   Un letterale senza segnaposti torna identico a sé (retrocompatibilità, D2).
 * @throws {TypeError} se gli argomenti non hanno il tipo atteso.
 */
function resolvePattern(pattern, zonesByName) {
  if (typeof pattern !== 'string') {
    throw new TypeError('resolvePattern: pattern must be a string');
  }
  // Il ramo « oggetto semplice » indicizza con un nome che arriva da un file di
  // configurazione, quindi passa da `hasOwnProperty`: senza, `{{constructor}}` o
  // `{{toString}}` pescherebbero dal PROTOTIPO un valore truthy, `zone.prefix`
  // sarebbe `undefined` e il pattern diventerebbe `"undefined/**"` — un letterale
  // che non matcha nessun URL, cioè il fail-open che questo modulo esiste per
  // impedire. È la stessa classe di difetto di REVIEW.md → B4.
  //
  // Il controllo di FORMA (`prefix` stringa) vale per entrambi i rami: protegge
  // anche da una mappa malformata passata dal chiamante.
  const rawLookup = zonesByName instanceof Map
    ? (name) => zonesByName.get(name)
    : (name) => (isPlainObject(zonesByName) && Object.prototype.hasOwnProperty.call(zonesByName, name)
      ? zonesByName[name]
      : undefined);
  const lookup = (name) => {
    const zone = rawLookup(name);
    return isPlainObject(zone) && typeof zone.prefix === 'string' ? zone : undefined;
  };

  const isRegex = pattern.startsWith(REGEX_PREFIX);
  const body = isRegex ? pattern.slice(REGEX_PREFIX.length) : pattern;

  const problems = [];
  let hadPlaceholder = false;
  const resolvedBody = body.replace(PLACEHOLDER_RE, (_match, rawName) => {
    hadPlaceholder = true;
    const zone = lookup(rawName);
    if (!zone) {
      problems.push(Object.freeze({
        kind: 'unknown-placeholder',
        pattern,
        placeholder: rawName,
        known: ZONE_NAMES,
      }));
      return ''; // irrilevante: con un problema il pattern viene scartato
    }
    return zone.prefix;
  });

  // Delimitatore spaiato (`{{admin`, `{admin}`, `}}`): la regex dei segnaposti non
  // lo intercetta, quindi resterebbe un letterale che non matcha nessun URL — il
  // fail-open che D2 vieta. Perciò è un problema, non un pattern.
  //
  // MA le graffe SINGOLE sono sintassi legittima dentro un `regex:`: `\d{1,3}` è un
  // quantificatore. Un controllo indiscriminato scartava quelle regex, cioè buttava
  // via una regola `requiresAuth` facendola ricadere nella defaultPolicy — lo
  // stesso danno che si vuole impedire, dal lato opposto. Quindi:
  //   • `{{` o `}}` DOPPIE → sempre un segnaposto non risolto, in regex come altrove;
  //   • graffa singola → problema solo FUORI da un `regex:`, dove non ha significato.
  const hasDoubledBrace = resolvedBody.includes('{{') || resolvedBody.includes('}}');
  const hasStraySingleBrace = !isRegex && /[{}]/.test(resolvedBody);
  if (hasDoubledBrace || hasStraySingleBrace) {
    problems.push(Object.freeze({
      kind: 'malformed-placeholder',
      pattern,
      detail: hasDoubledBrace
        ? 'delimitatore {{ o }} spaiato: un segnaposto non risolto non può restare un letterale'
        : 'graffa singola fuori da un pattern regex:, dove non ha significato',
    }));
  }

  // Un pattern vuoto (o di soli spazi) non è un pattern. Senza questo controllo
  // `{'': regola}` diventava silenziosamente `{'/': regola}`, cioè portava la
  // homepage pubblica dietro l'autenticazione senza una diagnostica.
  if (resolvedBody.trim() === '' && !hadPlaceholder) {
    problems.push(Object.freeze({
      kind: 'empty-pattern',
      pattern,
      detail: 'pattern vuoto o di soli spazi',
    }));
  }

  if (problems.length > 0) return { pattern: null, problems: Object.freeze(problems) };

  // `{{site}}` da solo risolve a stringa vuota: la radice del sito è `/`. Vale solo
  // se un segnaposto c'era davvero — un letterale vuoto è il problema qui sopra.
  const finalBody = resolvedBody === '' ? '/' : resolvedBody;
  return {
    pattern: isRegex ? `${REGEX_PREFIX}${finalBody}` : finalBody,
    problems: Object.freeze([]),
  };
}

/**
 * Risolve e espande un intero ruleset. È l'operazione che la Fase 2 chiamerà da
 * `accessManager.loadRules()`.
 *
 * Tre passaggi, in quest'ordine:
 *   1. **risoluzione** dei segnaposti di ogni pattern (quelli con problemi sono scartati);
 *   2. **collisioni** fra pattern diversi che risolvono alla stessa stringa: identici →
 *      assorbiti in silenzio, diversi → problema (le regole sono un oggetto keyed by
 *      pattern, e `{...customRules, ...hardcodedRules}` oggi le schiaccerebbe senza
 *      un fiato);
 *   3. **derivazione** della forma senza estensione, quando `hideExtension` è acceso per
 *      la zona del pattern (D5). Si DERIVA, non si sostituisce: la forma estesa resta
 *      attiva perché a valle risponde con un redirect, e una forma estesa non protetta
 *      regalerebbe a un anonimo la conferma che la pagina esiste.
 *
 * La derivazione viene DOPO, così ciò che una persona ha scritto esplicitamente vince
 * sempre sulla forma derivata. Un config non ancora migrato che porta entrambe le forme
 * con la stessa regola non produce quindi nessun problema: la derivata viene assorbita.
 *
 * @param {object} rules - Mappa `{ pattern: regola }` come arriva dal `.json5`.
 * @param {{zones: object[], byName: Map}} zoneMap - Il risultato di `resolvePathZones`.
 * @returns {{rules: object, problems: object[], derived: string[]}}
 * @throws {TypeError} se gli argomenti non hanno il tipo atteso.
 */
function resolveRuleset(rules, zoneMap) {
  if (!isPlainObject(rules)) {
    throw new TypeError('resolveRuleset: rules must be an object');
  }
  if (!isPlainObject(zoneMap) || !Array.isArray(zoneMap.zones) || !(zoneMap.byName instanceof Map)) {
    throw new TypeError('resolveRuleset: zoneMap must be the result of resolvePathZones()');
  }

  const out = {};
  const problems = [];
  const derived = [];
  const sourceOf = new Map(); // pattern risolto → pattern sorgente (per i messaggi)
  // Coppie estesa↔pulita già segnalate. La derivazione guarda nelle due direzioni,
  // quindi lo stesso conflitto verrebbe trovato due volte (da `/x` verso `/x.ejs` e
  // viceversa): è un conflitto solo, e va stampato una volta.
  const reportedTwinPairs = new Set();

  // ── 1+2. Risoluzione e collisioni fra pattern espliciti ──
  for (const [rawPattern, rule] of Object.entries(rules)) {
    const { pattern: resolved, problems: patternProblems } = resolvePattern(rawPattern, zoneMap.byName);
    if (resolved === null) {
      problems.push(...patternProblems);
      continue; // fail-closed: non si registra un pattern che non si è capito
    }

    if (Object.prototype.hasOwnProperty.call(out, resolved)) {
      if (!sameRule(out[resolved], rule)) {
        problems.push(Object.freeze({
          kind: 'collision',
          pattern: resolved,
          sources: Object.freeze([sourceOf.get(resolved), rawPattern]),
          detail: 'due pattern risolvono allo stesso URL con regole diverse',
        }));
      }
      // Vince l'ULTIMO, non il primo. Il chiamante costruisce il ruleset con
      // `{...config.customRules, ...config.hardcodedRules}`
      // (`accessManager.loadRules()`:55), cioè con la semantica dell'object spread,
      // dove le hardcoded — `editable: false` — sovrascrivono le custom. Con
      // « vince il primo » un `{{admin}}/**` scritto fra le custom avrebbe
      // spodestato la `/admin/**` hardcoded, invertendo quella precedenza. Il
      // problema resta riportato: non è una via silenziosa per sovrascrivere.
    }

    out[resolved] = rule;
    sourceOf.set(resolved, rawPattern);
  }

  // ── 3. Derivazione fra forma ESTESA e forma PULITA, nelle due direzioni ──
  //
  // Entrambe servono, perché con `hideExtension` acceso i due URL servono la stessa
  // pagina e lasciarne uno scoperto è una fuga: la forma estesa non protetta risponde
  // 301 (conferma che la pagina esiste), la forma pulita non protetta serve la pagina.
  //
  // La direzione pulita→estesa non è teorica: `accessControl.default.json5` spedisce
  // TRE regole in forma pulita (`userProfile`, `login`, `logout`), quindi senza questa
  // direzione le rispettive forme `.ejs` resterebbero fuori da ogni regola.
  for (const resolved of Object.keys(out)) {
    if (resolved.startsWith(REGEX_PREFIX)) continue; // una regex gestisce da sé il proprio matching

    const zone = zoneForPath(resolved, zoneMap.zones);
    if (!zone || !zone.ext) continue;

    let twin = null;
    if (resolved.endsWith(zone.ext)) {
      // ESTESA → PULITA. Non si deriva da un `**` immediatamente prima
      // dell'estensione: `/admin/docs/**.ejs` compila in `^/admin/docs/.*\.ejs$`,
      // mentre il gemello `/admin/docs/**` compila in `^/admin/docs/.*$` — STRETTAMENTE
      // più larga, quindi una regola permissiva si estenderebbe a file che non sono
      // pagine (`db-dump.sql`, `secret.json`). Non esiste un pattern che dica « ogni
      // path che NON finisce con un'estensione », quindi il gemello va scritto a mano.
      const candidate = resolved.slice(0, -zone.ext.length);
      if (candidate.endsWith('**')) {
        problems.push(Object.freeze({
          kind: 'underivable-pattern',
          pattern: resolved,
          zone: zone.name,
          detail: 'un `**` prima dell\'estensione non ha un gemello pulito esprimibile: '
            + 'il gemello sarebbe piu\' largo dell\'originale. Scrivere la forma pulita a mano.',
        }));
        continue;
      }
      twin = candidate;
    } else if (
      !resolved.includes('*')                       // un gemello di un wildcard sarebbe ridondante o fuorviante
      && resolved !== '/' && !resolved.endsWith('/') // le radici non sono file
      && resolved !== zone.prefix                    // nemmeno la radice della zona
      && !resolved.slice(resolved.lastIndexOf('/') + 1).includes('.') // ← è davvero una URL PULITA?
    ) {
      // PULITA → ESTESA, solo per ciò che È una URL pulita: ultimo segmento senza
      // punto. `koa-classic-server` matcha per SUFFISSO e accetta suffissi composti,
      // quindi tecnicamente `/admin/a.css` sarebbe la forma pulita di
      // `/admin/a.css.ejs` — ma derivare un gemello `.ejs` per ogni regola su
      // immagini e fogli di stile è rumore su file che non esistono. Chi ha un
      // `a.css.ejs` scrive il gemello a mano.
      twin = `${resolved}${zone.ext}`;
    }

    if (twin === null || twin === '') continue;

    if (Object.prototype.hasOwnProperty.call(out, twin)) {
      // Già presente: se è la stessa regola è il config non ancora migrato che porta
      // entrambe le forme → assorbito. Se è diversa, con `hideExtension` acceso i due
      // URL servono la stessa pagina con regole diverse: è un difetto, va detto.
      const pairKey = [resolved, twin].sort().join('\u0000');
      if (!sameRule(out[twin], out[resolved]) && !reportedTwinPairs.has(pairKey)) {
        reportedTwinPairs.add(pairKey);
        problems.push(Object.freeze({
          kind: 'collision',
          pattern: twin,
          sources: Object.freeze([sourceOf.get(twin), `${sourceOf.get(resolved)} (derivata)`]),
          detail: `con hideExtension attivo in zona "${zone.name}" le due forme servono la stessa pagina`,
        }));
      }
      continue;
    }

    out[twin] = Object.freeze({ ...out[resolved], derivedFrom: resolved });
    sourceOf.set(twin, `${sourceOf.get(resolved)} (derivata)`);
    derived.push(twin);
  }

  return { rules: out, problems: Object.freeze(problems), derived: Object.freeze(derived) };
}

module.exports = {
  resolvePathZones,
  resolveRuleset,
  resolvePattern,
  zoneForPath,
  ZONE_NAMES,
};
