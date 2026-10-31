/**
 * Unit Tests: la stanza canonica dei segnaposti di percorso (D8 di path-zones).
 *
 * ─── PERCHE QUESTO TEST ESISTE ───────────────────────────────────────────────
 * La decisione chiede che ogni file di configurazione che accetta segnaposti
 * porti una spiegazione concisa. La prosa duplicata però DERIVA: fra sei mesi
 * N copie direbbero N cose leggermente diverse, e quella sbagliata starebbe in
 * un file di sicurezza.
 *
 * La stanza è quindi UNA, identica byte per byte, e questo test lo presidia —
 * stesso genere di presidio di `middlewareOrder.test.js` e
 * `routeContract.test.js`, che pinnano un'invariante che nessun altro tiene.
 *
 * Oggi il file è uno solo (`accessControl.default.json5`): il presidio nasce con
 * la Fase 4 proprio perché la Fase 5 ne aggiungerà altri cinque, e a quel punto
 * la deriva diventa possibile. Un test che nasce dopo il problema arriva tardi.
 *
 * → docs/decisions/path-zones.it.md (D8)
 */

const fs = require('fs');
const path = require('path');

const { ZONE_NAMES } = require('../../../core/pathZoneResolver');

const REPO = path.join(__dirname, '../../..');

/**
 * La stanza canonica, nella sua unica forma ammessa.
 *
 * Qualunque modifica va fatta QUI e replicata in tutti i file: è il punto del
 * presidio. Non elenca tutti i nomi di zona di proposito — ogni estensione del
 * vocabolario imporrebbe altrimenti N modifiche — e rimanda alla decisione.
 */
const CANONICAL_STANZA = [
  '  // ── Segnaposti di percorso ──────────────────────────────────────────',
  '  // I pattern possono usare {{admin}}, {{pluginPages}}, … al posto del',
  '  // prefisso concreto: il CMS lo risolve al caricamento leggendo le zone.',
  '  // Un segnaposto sconosciuto è un ERRORE, mai un letterale.',
  '  // Elenco completo e regole → docs/decisions/path-zones.it.md',
  '  // ────────────────────────────────────────────────────────────────────',
].join('\n');

/**
 * I file di configurazione che accettano segnaposti.
 *
 * La Fase 5 aggiungerà qui `sentinelRules`, `seoPages`, `protectedRoutes` e gli
 * altri man mano che vengono convertiti: aggiungere il file a questo elenco è
 * ciò che ne richiede la stanza.
 */
const FILES_WITH_PLACEHOLDERS = [
  'plugins/adminAccessControl/accessControl.default.json5',
];

describe('stanza canonica dei segnaposti', () => {
  test.each(FILES_WITH_PLACEHOLDERS)('%s la porta, identica byte per byte', (relPath) => {
    const content = fs.readFileSync(path.join(REPO, relPath), 'utf8');
    expect(content).toContain(CANONICAL_STANZA);
  });

  test('i nomi di zona citati nella stanza esistono davvero', () => {
    // Una stanza che cita un segnaposto inesistente insegnerebbe un errore.
    for (const cited of CANONICAL_STANZA.matchAll(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g)) {
      expect(ZONE_NAMES).toContain(cited[1]);
    }
  });

  test('la stanza NON elenca tutti i nomi di zona', () => {
    // Deliberato: elencarli tutti farebbe sì che ogni estensione del vocabolario
    // imponga una modifica in ogni file. L'elenco completo sta nella decisione.
    const cited = [...CANONICAL_STANZA.matchAll(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g)].map((m) => m[1]);
    expect(cited.length).toBeLessThan(ZONE_NAMES.length);
  });

  // La stanza rimanda a « elenco completo » nella decisione, ma il README del
  // plugin lo riporta per esteso in una tabella. Una tabella scritta a mano è
  // esattamente ciò che DERIVA: documenterebbe un vocabolario che il codice non
  // ha più — la forma del difetto che questa decisione esiste per chiudere,
  // spostata dal config alla documentazione.
  test('la tabella del vocabolario nel README del plugin combacia con ZONE_NAMES', () => {
    const readme = fs.readFileSync(
      path.join(REPO, 'plugins/adminAccessControl/README.it.md'), 'utf8'
    );
    // Solo le righe di tabella `| {{nome}} | … |`, non i segnaposti citati in prosa.
    const documented = [...readme.matchAll(/^\|\s*`\{\{([A-Za-z][A-Za-z0-9]*)\}\}`\s*\|/gm)]
      .map((m) => m[1]);

    expect(documented.sort()).toEqual([...ZONE_NAMES].sort());
  });

  test('ogni file che USA un segnaposto è nell\'elenco presidiato', () => {
    // Il buco da chiudere: un file convertito ai segnaposti e dimenticato qui
    // non avrebbe la stanza, e nessuno se ne accorgerebbe.
    const candidates = fs.readdirSync(path.join(REPO, 'plugins'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .flatMap((e) => {
        const dir = path.join(REPO, 'plugins', e.name);
        return fs.readdirSync(dir)
          .filter((f) => f.endsWith('.default.json5'))
          .map((f) => `plugins/${e.name}/${f}`);
      });

    const usesPlaceholders = candidates.filter((rel) => {
      const content = fs.readFileSync(path.join(REPO, rel), 'utf8');
      // Un segnaposto dentro una CHIAVE, cioè un pattern — non in un commento.
      return /^\s*["']\{\{[A-Za-z]/m.test(content);
    });

    expect(usesPlaceholders.sort()).toEqual([...FILES_WITH_PLACEHOLDERS].sort());
  });
});
