/**
 * accessInvariantCheck — le invarianti di accesso (`accessInvariants`), verificate
 * sull'EFFETTO e non sulla forma del file.
 *
 * Modulo **puro**: nessun I/O, nessun filesystem, nessun `process.exit`. Riceve la
 * funzione di decisione come **parametro**, così il core dichiara *cosa* deve valere
 * e il plugin fornisce *chi* decide: il core non dipende da un plugin, e il plugin
 * resta sostituibile. Gemello di `core/storageWritabilityCheck.js` per il ruolo
 * (gate che il boot consulta) e di `core/pathZoneResolver.js` per la forma
 * (riporta, non decide).
 *
 * → Decisione: `docs/decisions/path-zones.it.md` (D6, D7)
 *
 * ─── PERCHÉ SONDE E NON CONTROLLI SULLA FORMA ────────────────────────────────
 * L'istinto sarebbe chiedere « esiste una regola con pattern `/admin/**` e
 * `requiresAuth: true`? ». È fragile: guarda com'è scritto il file, non cosa fa.
 * Non vede una `defaultPolicy` sbagliata, non vede una priorità invertita, non vede
 * una regola custom che scavalca il `baseline` della zona — cioè A3.
 *
 * Le sonde chiedono invece « cosa risponderebbe il sistema a QUESTA richiesta? »,
 * ed esercitano la vera funzione di decisione. Conseguenze: catturano anche i
 * difetti che nessuno ha previsto, sopravvivono a qualunque rifattorizzazione
 * interna, costano zero (sole chiamate a funzioni pure), e la stessa tabella è sia
 * il gate di boot sia la suite di regressione, invece di scrivere le cose due volte.
 *
 * ─── LE SONDE SI DERIVANO DALLE ZONE, NON SI ELENCANO ────────────────────────
 * Una tabella scritta a mano diventa stantia nel momento in cui qualcuno aggiunge
 * una zona: la zona nuova non comparirebbe, e nessuno se ne accorgerebbe. Qui le
 * sonde sistematiche sono **derivate** dal `baseline` di ogni zona:
 *
 *   per ogni zona con baseline CHIUSO:
 *     • un anonimo deve essere NEGATO
 *     • un ruolo fuori da `allowedRoles` deve essere NEGATO
 *     • ogni ruolo in `allowedRoles` deve essere CONSENTITO
 *
 * Una zona chiusa aggiunta domani è quindi coperta senza toccare questo file.
 *
 * ─── L'UNICA SONDA NON DERIVABILE: IL LOGIN ──────────────────────────────────
 * « Un anonimo deve poter raggiungere la pagina di login » non si deduce dalle
 * zone, e la sua violazione è la peggiore della famiglia: chi viene rifiutato è
 * mandato a una pagina che lo rifiuta a sua volta — un **loop di redirect** — e
 * nessuno può più autenticarsi per correggere la configurazione dalla GUI. È
 * irrecuperabile dall'interfaccia, quindi va presidiata.
 *
 * L'URL non è cablato: si prende da `defaultPolicy.redirectOnDenied`, cioè dalla
 * pagina verso cui il motore stesso manda chi rifiuta. La sonda diventa così
 * auto-coerente — asserisce che *la pagina verso cui mandiamo le persone deve
 * essere raggiungibile da quelle persone*.
 *
 * ─── COSA NON È UN'INVARIANTE ────────────────────────────────────────────────
 * La tabella di D6 includeva « un anonimo deve raggiungere
 * {{publicThemeResources}} ». Qui è stata **esclusa di proposito**: un
 * amministratore può legittimamente mettere dietro autenticazione l'intero sito,
 * risorse comprese, e renderlo fatale vieterebbe una configurazione valida. Il
 * guasto, se è un errore, è **visibile** (il sito esce senza stile) e
 * **recuperabile** (si corregge dalla GUI, a cui si accede ancora). Il login no:
 * per quello non c'è né visibilità né recupero. Vedi la decisione, *Fase 3*.
 *
 * @module core/accessInvariantCheck
 */

'use strict';

/** Ruolo usato come « autenticato ma senza i permessi della zona ». */
const UNPRIVILEGED_PROBE_ROLE = 2; // editor: ruolo di sistema, non ammesso in nessuna zona chiusa

/**
 * Descrive le sonde che `checkAccessInvariants` eseguirà, senza eseguirle.
 *
 * Serve ai test e alla diagnostica: permette di vedere *cosa* viene verificato su
 * una configurazione data, senza bisogno di una funzione di decisione.
 *
 * @param {{zones: object[]}} zoneMap - Il risultato di `resolvePathZones`.
 * @param {object} [options]
 * @param {string|null} [options.loginUrl] - URL della pagina di login, se noto.
 * @returns {object[]} Sonde: `{ id, url, roleIds, expect, why }`.
 *   `roleIds: null` = anonimo. `expect`: `'deny'` | `'allow'`.
 * @throws {TypeError} se `zoneMap` non ha la forma attesa.
 */
function describeAccessInvariants(zoneMap, options = {}) {
  if (!zoneMap || !Array.isArray(zoneMap.zones)) {
    throw new TypeError('describeAccessInvariants: zoneMap must be the result of resolvePathZones()');
  }

  const probes = [];

  for (const zone of zoneMap.zones) {
    const baseline = zone.baseline;
    // Si presidiano le zone CHIUSE. Su una zona aperta non c'è un minimo da
    // violare, e asserire « deve restare aperta » vieterebbe un sito privato.
    if (!baseline || baseline.requiresAuth !== true) continue;
    if (zone.prefix === '') continue; // la zona di default non ha un prefisso da sondare

    const roles = Array.isArray(baseline.allowedRoles) ? baseline.allowedRoles : [];

    // Due path per zona: la radice e qualcosa in profondità. Il secondo coglie il
    // caso in cui a proteggere sia una regola esatta invece del `baseline`.
    for (const url of [`${zone.prefix}/`, `${zone.prefix}/invariant-probe/deep.ejs`]) {
      probes.push(Object.freeze({
        id: `${zone.name}:anonymous:${url}`,
        url,
        roleIds: null,
        expect: 'deny',
        why: `la zona "${zone.name}" ha baseline chiuso: un anonimo non deve entrare`,
      }));

      if (roles.length > 0 && !roles.includes(UNPRIVILEGED_PROBE_ROLE)) {
        probes.push(Object.freeze({
          id: `${zone.name}:unprivileged:${url}`,
          url,
          roleIds: [UNPRIVILEGED_PROBE_ROLE],
          expect: 'deny',
          why: `la zona "${zone.name}" ammette i ruoli [${roles.join(', ')}]: `
            + `un utente con ruolo ${UNPRIVILEGED_PROBE_ROLE} non deve entrare`,
        }));
      }
    }

    // Ogni ruolo ammesso DEVE entrare: un presidio chiuso troppo non è sicurezza,
    // è un pannello inaccessibile al suo amministratore.
    for (const role of roles) {
      probes.push(Object.freeze({
        id: `${zone.name}:role${role}:${zone.prefix}/`,
        url: `${zone.prefix}/`,
        roleIds: [role],
        expect: 'allow',
        why: `la zona "${zone.name}" ammette il ruolo ${role}: deve poter entrare`,
      }));
    }
  }

  // L'unica sonda non derivabile dalle zone.
  if (typeof options.loginUrl === 'string' && options.loginUrl !== '') {
    probes.push(Object.freeze({
      id: `login:anonymous:${options.loginUrl}`,
      url: options.loginUrl,
      roleIds: null,
      expect: 'allow',
      why: 'è la pagina verso cui il motore manda chi rifiuta: se la rifiutasse a '
        + 'sua volta nessuno potrebbe più autenticarsi (loop di redirect)',
    }));
  }

  return probes;
}

/**
 * Esegue le sonde e riporta quelle il cui verdetto non corrisponde all'atteso.
 *
 * NON lancia e non termina il processo: riporta. Il chiamante decide — fatale al
 * boot, rifiuto del ruleset a runtime (D7).
 *
 * @param {function(string, object|null): {allowed: boolean}} decide - La funzione di
 *   decisione: riceve `(url, user)` e ritorna almeno `{ allowed }`.
 * @param {{zones: object[]}} zoneMap - Il risultato di `resolvePathZones`.
 * @param {object} [options]
 * @param {string|null} [options.loginUrl] - Vedi `describeAccessInvariants`.
 * @returns {{problems: object[], probed: number}} `problems` ha `kind:
 *   'invariant-violation'`; `probed` è il numero di sonde eseguite (zero è a sua
 *   volta un'informazione: significa nessuna zona chiusa da presidiare).
 * @throws {TypeError} se `decide` non è una funzione.
 */
function checkAccessInvariants(decide, zoneMap, options = {}) {
  if (typeof decide !== 'function') {
    throw new TypeError('checkAccessInvariants: decide must be a function');
  }

  const probes = describeAccessInvariants(zoneMap, options);
  const problems = [];

  for (const probe of probes) {
    let verdict;
    try {
      verdict = decide(probe.url, probe.roleIds === null ? null : { roleIds: probe.roleIds });
    } catch (err) {
      // Una funzione di decisione che LANCIA è essa stessa una violazione: su quella
      // richiesta il sito non saprebbe cosa rispondere.
      problems.push(Object.freeze({
        kind: 'invariant-violation',
        probe: probe.id,
        url: probe.url,
        roleIds: probe.roleIds,
        expected: probe.expect,
        actual: 'throw',
        detail: `${probe.why} — invece la decisione è terminata con un errore: ${err.message}`,
      }));
      continue;
    }

    const allowed = !!(verdict && verdict.allowed);
    const matches = probe.expect === 'allow' ? allowed : !allowed;
    if (matches) continue;

    problems.push(Object.freeze({
      kind: 'invariant-violation',
      probe: probe.id,
      url: probe.url,
      roleIds: probe.roleIds,
      expected: probe.expect,
      actual: allowed ? 'allow' : 'deny',
      detail: probe.why,
    }));
  }

  return { problems: Object.freeze(problems), probed: probes.length };
}

// ─── Il box [ACCESS] ─────────────────────────────────────────────────────────
//
// I messaggi sono DIAGNOSTICI, non prescrittivi: dicono quale file, quale pattern
// o chiave, e cosa non va. NON dicono cosa scrivere al suo posto, perché per la
// maggior parte di questi problemi l'intento dell'autore non è desumibile — una
// `collision` fra due regole diverse può volersi risolvere in entrambi i versi, e
// un suggerimento inventato dentro un box di sicurezza è peggio del silenzio.
// L'unica eccezione è `unknown-placeholder`, dove la risposta è CHIUSA: i nomi di
// zona validi, che il problema porta già con sé.

// A quale file appartiene la causa di ciascun tipo di problema. I due problemi di
// zona NON nascono nel file delle regole: nascono dai prefissi in `ital8Config.json5`,
// che sta nella RADICE del progetto. Mandare chi legge a cercarli nella cartella del
// plugin sarebbe un messaggio diagnostico che punta al file sbagliato.
const ZONE_PROBLEM_KINDS = Object.freeze(['zone-prefix-invalid', 'zone-prefix-collision']);
const ROOT_CONFIG_FILE = 'ital8Config.json5';

/** Una riga per problema: dove sta, su cosa, e cosa non va. */
function describeProblem(problem) {
  const where = problem.pattern
    ? `pattern "${problem.pattern}"`
    : (problem.prefixes ? `prefissi ${problem.prefixes.join(' e ')}`
      : (problem.prefix ? `prefisso "${problem.prefix}"`
        : (problem.url ? `URL ${problem.url}` : null)));

  const bits = [problem.kind];
  if (where) bits.push(where);
  if (problem.zone) bits.push(`zona "${problem.zone}"`);
  if (problem.key) bits.push(`chiave "${problem.key}"`);
  if (problem.keys) bits.push(`chiavi ${problem.keys.join(' e ')}`);
  if (problem.sources) bits.push(`da ${problem.sources.join(' e ')}`);
  if (problem.roleIds) bits.push(`ruoli ${JSON.stringify(problem.roleIds)}`);
  if (problem.expected && problem.actual) bits.push(`atteso ${problem.expected}, ottenuto ${problem.actual}`);
  return bits.join(' · ');
}

/**
 * Compone il box `[ACCESS]`, nello stile dei box esistenti del progetto
 * (`[SESSION]`, `[SCHEMA]`, `[WEIGHT]`, `[STORAGE]`): righe prefissate dal tag,
 * la causa, e il file da aprire.
 *
 * @param {object[]} problems - I problemi raccolti (zone + ruleset + invarianti).
 * @param {object} [options]
 * @param {boolean} [options.fatal] - `true` al boot (il CMS non parte), `false` a runtime.
 * @param {string} [options.rulesFile] - Path del file delle regole, se noto. I due
 *   problemi di ZONA vengono comunque attribuiti a `ital8Config.json5` nella radice
 *   del progetto, che è dove nascono.
 * @returns {string[]} Righe pronte da stampare, una per `console.error`/`warn`.
 */
function formatAccessProblemsBox(problems, options = {}) {
  const rule = '[ACCESS] ' + '═'.repeat(66);
  const lines = [rule];

  lines.push(options.fatal
    ? '[ACCESS]  ⚠  CONTROLLO ACCESSI NON APPLICABILE — il CMS non parte'
    : '[ACCESS]  ⚠  Modifica RIFIUTATA — resta in vigore il ruleset precedente');
  lines.push('[ACCESS]');
  lines.push(`[ACCESS]  ${problems.length} problem${problems.length === 1 ? 'a' : 'i'} nel controllo accessi.`);
  lines.push('[ACCESS]  Ogni riga dice DOVE sta il problema e COSA non va; la');
  lines.push('[ACCESS]  correzione resta una scelta di chi conosce l\'intento.');
  lines.push('[ACCESS]');

  // Raggruppate per file, così si sa quale aprire.
  const rulesFile = options.rulesFile || 'accessControl.json5';
  const byFile = new Map();
  for (const problem of problems) {
    let key;
    if (ZONE_PROBLEM_KINDS.includes(problem.kind)) key = ROOT_CONFIG_FILE;
    else if (problem.kind === 'invariant-violation') key = '(effetto del ruleset nel suo insieme)';
    else key = rulesFile;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(problem);
  }

  for (const [file, group] of byFile) {
    lines.push(`[ACCESS]  ── ${file}`);
    for (const problem of group) {
      lines.push(`[ACCESS]     • ${describeProblem(problem)}`);
      if (problem.detail) lines.push(`[ACCESS]       ${problem.detail}`);
      // Unica eccezione alla regola « non prescrivere »: qui la risposta è chiusa.
      if (problem.kind === 'unknown-placeholder' && Array.isArray(problem.known)) {
        lines.push(`[ACCESS]       nomi di zona validi: ${problem.known.join(', ')}`);
      }
    }
    lines.push('[ACCESS]');
  }

  if (options.fatal) {
    lines.push('[ACCESS]  Il controllo accessi è essenziale: senza, il sito sarebbe');
    lines.push('[ACCESS]  servito senza guardia. Corretti i file sopra, riavviare.');
  } else {
    lines.push('[ACCESS]  Il file su disco NON è stato modificato.');
  }
  lines.push(rule);
  return lines;
}

module.exports = {
  describeAccessInvariants,
  checkAccessInvariants,
  formatAccessProblemsBox,
  UNPRIVILEGED_PROBE_ROLE,
};
