/**
 * Il round-trip delle GUI admin: ciò che una sezione CARICA deve essere
 * qualcosa che la stessa sezione può SALVARE.
 *
 * Perché questo presidio esiste. Le sezioni admin che editano un file di
 * configurazione sono fatte di due metà: una che legge il file e lo mette
 * nell'editor, una che lo valida al salvataggio. Le due metà devono concordare
 * sulla FORMA del file che si scambiano — e quando divergono non lo dice
 * nessuno, perché ciascuna metà ha i suoi test e ciascuna passa.
 *
 * È già costato due difetti, entrambi trovati per caso e a suite verde:
 *
 *   1. `admin` / System Settings — il validatore pretendeva `useHttps`,
 *      `httpsPort` e `AutoRedirectHttpPortToHttpsPort`, i nomi piatti della
 *      struttura precedente al blocco `https` annidato. Ogni salvataggio
 *      rispondeva « Campo obbligatorio mancante » e la sezione era
 *      inutilizzabile. (REVIEW.md → B3, corretto nella v3.51.0)
 *
 *   2. `adminSeo` / pageRules — `schemaVersion` sta al primo livello del file,
 *      accanto ai pattern, e il validatore lo trattava come un pattern:
 *      « "schemaVersion": rule must be an object », cioè 400 a ogni salvataggio.
 *      (corretto nella v3.51.0)
 *
 * I test esistenti non potevano vederli: chiamavano i validatori con payload
 * scritti a mano nella forma che il validatore si aspettava, mai con il file
 * reale. Questo presidio fa l'unica cosa che li avrebbe colti — prende il file
 * COME STA SU DISCO e lo passa al validatore che lo riceverebbe al salvataggio.
 *
 * La seconda metà del file è un CENSIMENTO: ogni plugin admin che espone una
 * rotta POST deve comparire qui, o fra le esenzioni DICHIARATE con la loro
 * ragione. Così una sezione nuova non può entrare nel progetto senza che
 * qualcuno abbia deciso se il round-trip la riguarda.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const JSON5 = require('json5');
const loadJson5 = require('../../../core/loadJson5');

const RADICE = path.join(__dirname, '../../..');
const vivo = (rel) => path.join(RADICE, rel);

// ──────────────────────────────────────────────────────────────────────────────
// Le coppie carica → valida, sul file REALE
// ──────────────────────────────────────────────────────────────────────────────

const COPPIE = [
  {
    gui: 'admin',
    sezione: 'systemSettings',
    file: 'ital8Config.json5',
    giro: () => {
      const { getSystemConfig, validateSystemConfig } = require('../../../plugins/admin/systemSettings');
      const caricato = getSystemConfig();
      expect(caricato.success).toBe(true);
      return validateSystemConfig(caricato.config);
    },
  },
  {
    gui: 'adminSeo',
    sezione: 'pageRules',
    file: 'plugins/seo/seoPages.json5',
    giro: () => {
      const fm = require('../../../plugins/adminSeo/lib/seoFileManager');
      const v = require('../../../plugins/adminSeo/lib/seoConfigValidator');
      const letto = fm.readPageRules(vivo('plugins/seo'));
      expect(letto.success).toBe(true);
      // la GUI rimanda il TESTO che ha ricevuto: lo si riparsifica come fa la rotta
      return v.validatePageRules(JSON5.parse(letto.raw));
    },
  },
  {
    gui: 'adminSeo',
    sezione: 'globalSettings',
    file: 'plugins/seo/pluginConfig.json5 (custom)',
    giro: () => {
      const fm = require('../../../plugins/adminSeo/lib/seoFileManager');
      const v = require('../../../plugins/adminSeo/lib/seoConfigValidator');
      const letto = fm.readGlobalSettings(vivo('plugins/seo'));
      expect(letto.success).toBe(true);
      return v.validateGlobalSettings(letto.data !== undefined ? letto.data : letto);
    },
  },
  {
    gui: 'adminRateLimiter',
    sezione: 'rules + config',
    file: 'plugins/rateLimiter/protectedRoutes.json5',
    giro: () => {
      const { validate } = require('../../../plugins/rateLimiter/lib/configValidator');
      const custom = loadJson5(vivo('plugins/rateLimiter/pluginConfig.json5')).custom;
      const regole = loadJson5(vivo('plugins/rateLimiter/protectedRoutes.json5'));
      // le due rotte della GUI passano entrambe da `validate(custom, regole)`
      return validate(custom, regole);
    },
  },
  {
    gui: 'adminAnalytics',
    sezione: 'analyticsSettings',
    file: 'plugins/analytics/pluginConfig.json5 (custom)',
    giro: () => {
      const v = require('../../../plugins/adminAnalytics/lib/analyticsConfigValidator');
      return v.validateSettings(loadJson5(vivo('plugins/analytics/pluginConfig.json5')).custom);
    },
  },
  {
    gui: 'adminCsrfProtection',
    sezione: 'csrfManagement',
    file: 'plugins/csrfProtection/pluginConfig.json5 (custom)',
    giro: () => {
      const servizio = require('../../../plugins/csrfProtection/main.js');
      const condiviso = servizio.getObjectToShareToOthersPlugin('adminCsrfProtection');
      expect(typeof condiviso.validateConfig).toBe('function');
      return condiviso.validateConfig(loadJson5(vivo('plugins/csrfProtection/pluginConfig.json5')).custom);
    },
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Le esenzioni, ciascuna con la sua ragione
// ──────────────────────────────────────────────────────────────────────────────

const ESENTI = {
  adminAccessControl:
    'il suo validatore gira AL BOOT sul file reale (accessManager): una deriva ' +
    'della forma non passa inosservata, ferma l\'avvio. È il presidio più forte ' +
    'possibile e non va duplicato qui.',
  adminSentinel:
    'riusa il validatore DEL SERVICE per scelta dichiarata nel codice, e il ' +
    'service valida le proprie regole al boot.',
  adminUsers:
    'scrive utenti e ruoli, non un descrittore di configurazione: la forma è ' +
    'presidiata da writerCensus e dai test di roleManagement.',
  adminMedia:
    'carica file binari; non c\'è un config che la GUI rilegge e rimanda.',
  adminBootstrapNavbar:
    'i file navbar li scrive l\'amministratore nella GUI stessa e non hanno un ' +
    '.default spedito: non esiste una forma distribuita con cui confrontarsi. ' +
    'L\'invariante vale in astratto, ma su un\'installazione pulita non c\'è ' +
    'nessun file navbar da sottoporre al giro.',
};

// ──────────────────────────────────────────────────────────────────────────────

describe('round-trip delle GUI admin: si salva ciò che si carica', () => {
  for (const { gui, sezione, file, giro } of COPPIE) {
    test(`${gui} / ${sezione}: ${file} passa il proprio validatore`, () => {
      const esito = giro();
      expect(esito).toBeDefined();
      // gli errori prima del booleano: se cade, il messaggio dice COSA non torna
      expect(esito.errors || []).toEqual([]);
      expect(esito.valid).toBe(true);
    });
  }

  test('le coppie coprono più di una GUI', () => {
    expect(new Set(COPPIE.map((c) => c.gui)).size).toBeGreaterThan(3);
  });
});

describe('censimento: nessuna GUI admin che salva resta fuori dal giro', () => {
  const pluginAdmin = () =>
    fs.readdirSync(vivo('plugins'))
      .filter((n) => n === 'admin' || n.startsWith('admin'))
      .filter((n) => fs.existsSync(vivo(path.join('plugins', n, 'main.js'))));

  test('ogni plugin admin con una rotta POST è in una coppia o fra le esenzioni', () => {
    const coperti = new Set(COPPIE.map((c) => c.gui));
    const scoperti = [];

    for (const nome of pluginAdmin()) {
      const src = fs.readFileSync(vivo(path.join('plugins', nome, 'main.js')), 'utf8');
      if (!/method:\s*'POST'/.test(src)) continue;
      if (coperti.has(nome) || Object.prototype.hasOwnProperty.call(ESENTI, nome)) continue;
      scoperti.push(nome);
    }

    expect(scoperti).toEqual([]);
  });

  test('ogni esenzione dichiara una ragione, e riguarda un plugin che esiste', () => {
    for (const [nome, ragione] of Object.entries(ESENTI)) {
      expect(fs.existsSync(vivo(path.join('plugins', nome)))).toBe(true);
      expect(typeof ragione).toBe('string');
      expect(ragione.length).toBeGreaterThan(40);
    }
  });

  test('nessuna esenzione duplica una coppia', () => {
    const coperti = new Set(COPPIE.map((c) => c.gui));
    const doppi = Object.keys(ESENTI).filter((n) => coperti.has(n));
    expect(doppi).toEqual([]);
  });
});
