/**
 * i18n.test.js
 *
 * ─── PERCHE QUESTO FILE ESISTE (revisione del plugin, rilievo 2) ──────────────
 * Gli EJS della sezione erano bilingui e i quattro file JS no: ~37 stringhe
 * italiane cablate, cioè tutta la metà VIVA dell'interfaccia — i badge delle
 * tabelle, i pulsanti che promuovono e retrocedono, e le due finestre di
 * conferma, compresa quella che avverte che si sta per chiudere fuori qualcuno.
 * Un amministratore in inglese leggeva intestazioni inglesi e contenuti
 * italiani.
 *
 * Qui si verificano le due cose che possono rompersi in silenzio:
 *
 *   1. il riempimento dei segnaposto (`snT`), l'unica logica del giro;
 *   2. che ogni chiave usata dal JS ESISTA nelle etichette della SUA pagina —
 *      un `t('chiaveSbagliata')` non lancia, stampa la chiave, e nessuno se ne
 *      accorge finché non lo vede un utente.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const os = require('os');

const SEZIONE = path.join(__dirname, '..', '..', 'adminWebSections', 'sentinelManagement');

const { snT } = require(path.join(SEZIONE, 'sentinel-i18n.js'));

/** Le quattro pagine e lo script che ciascuna carica. */
const PAGINE = [
  ['index.ejs', 'sentinel-admin.js'],
  ['rules.ejs', 'rules-editor.js'],
  ['ruleForm.ejs', 'rule-form.js'],
  ['tester.ejs', 'tester.js'],
];

/** Rende una pagina con un `__()` finto, e ne estrae le etichette. */
function etichetteDi(file, lang) {
  const vuoto = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ejs-i18n-')), 'vuoto.ejs');
  fs.writeFileSync(vuoto, '');

  const passData = {
    apiPrefix: 'api',
    adminPrefix: 'admin',
    themeSys: { getThemePartPath: () => vuoto },
    ctx: { lang },
    plugin: {
      adminSentinel: {
        autoRefreshSeconds: 15, eventLimit: 100, windowDays: 7, scannerThreshold: 20,
      },
    },
  };
  const traduci = (labels, ctx) => labels[(ctx && ctx.lang) || 'it'] || labels.it;

  const html = ejs.render(
    fs.readFileSync(path.join(SEZIONE, file), 'utf8'),
    { passData, __: traduci },
    { filename: path.join(SEZIONE, file) },
  );

  const blocco = html.match(/const SN_I18N = ([\s\S]*?);\n/);
  return blocco ? JSON.parse(blocco[1]) : null;
}

/** Le chiavi che uno script chiede: `t('chiave')`. */
function chiaviUsateDa(script) {
  const src = fs.readFileSync(path.join(SEZIONE, script), 'utf8');
  const chiavi = new Set();
  const re = /\bt\(\s*'([A-Za-z0-9_]+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) chiavi.add(m[1]);
  return Array.from(chiavi);
}

describe('snT — riempimento dei segnaposto', () => {
  beforeEach(() => { globalThis.SN_I18N = undefined; });
  afterEach(() => { delete globalThis.SN_I18N; });

  test('senza segnaposto restituisce l etichetta', () => {
    globalThis.SN_I18N = { saluto: 'Ciao' };
    expect(snT('saluto')).toBe('Ciao');
  });

  test('riempie i segnaposto per nome, non per posizione', () => {
    globalThis.SN_I18N = { riga: 'Regola "{rule}": {from} → {to}' };
    expect(snT('riga', { rule: 'php-probe', from: 'monitor', to: 'block' }))
      .toBe('Regola "php-probe": monitor → block');
  });

  // Il senso dei segnaposto: l'ordine delle parole appartiene alla traduzione.
  test('lo stesso set di valori regge un ordine diverso', () => {
    globalThis.SN_I18N = { riga: '{to} ← {from} (rule {rule})' };
    expect(snT('riga', { rule: 'x', from: 'monitor', to: 'block' }))
      .toBe('block ← monitor (rule x)');
  });

  test('lo stesso segnaposto ripetuto viene riempito ovunque', () => {
    globalThis.SN_I18N = { riga: '{n} su {n}' };
    expect(snT('riga', { n: 3 })).toBe('3 su 3');
  });

  test('i numeri e lo zero arrivano interi, non spariscono', () => {
    globalThis.SN_I18N = { riga: 'colpite {n} richieste' };
    expect(snT('riga', { n: 0 })).toBe('colpite 0 richieste');
  });

  // Un buco nella frase costringerebbe a indovinare cosa manca.
  test('un segnaposto senza valore resta scritto com è', () => {
    globalThis.SN_I18N = { riga: 'ciao {chi}' };
    expect(snT('riga', {})).toBe('ciao {chi}');
  });

  test('una chiave mancante torna la chiave, invece di un vuoto', () => {
    globalThis.SN_I18N = {};
    expect(snT('chiaveInesistente')).toBe('chiaveInesistente');
  });

  test('senza etichette del tutto non lancia', () => {
    expect(snT('qualsiasi')).toBe('qualsiasi');
  });

  test('non interpreta come segnaposto ciò che non lo è', () => {
    globalThis.SN_I18N = { riga: 'un {oggetto con spazi} resta com è' };
    expect(snT('riga', { oggetto: 'x' })).toBe('un {oggetto con spazi} resta com è');
  });
});

describe('etichette delle pagine', () => {
  test.each(PAGINE)('%s dichiara etichette valide in italiano e inglese', (file) => {
    for (const lang of ['it', 'en']) {
      const etichette = etichetteDi(file, lang);
      expect(etichette).not.toBeNull();
      expect(Object.keys(etichette).length).toBeGreaterThan(0);
      for (const [chiave, valore] of Object.entries(etichette)) {
        expect(typeof valore).toBe('string');
        expect(valore.length).toBeGreaterThan(0);
        // Il motivo per cui si passa da JSON.stringify e non dal tag escapato:
        // in italiano ogni apostrofo arriverebbe a schermo come "&#39;".
        expect(valore).not.toMatch(/&#\d+;|&quot;|&amp;|&lt;|&gt;/);
        expect(chiave).toMatch(/^[A-Za-z0-9_]+$/);
      }
    }
  });

  test.each(PAGINE)('%s traduce davvero: italiano e inglese differiscono', (file) => {
    const it = etichetteDi(file, 'it');
    const en = etichetteDi(file, 'en');
    const diverse = Object.keys(it).filter((k) => it[k] !== en[k]);
    // Qualche etichetta coincide per forza (i simboli, i nomi propri): quello
    // che conta è che la pagina non sia rimasta monolingue.
    expect(diverse.length).toBeGreaterThan(Object.keys(it).length / 2);
  });

  // Il difetto che questo test esiste per impedire: `t('chiaveSbagliata')` non
  // lancia, stampa la chiave, e lo scopre un utente.
  test.each(PAGINE)('%s: ogni chiave usata da %s esiste fra le etichette', (file, script) => {
    const etichette = etichetteDi(file, 'it');
    const mancanti = chiaviUsateDa(script).filter(
      (k) => !Object.prototype.hasOwnProperty.call(etichette, k));
    expect(mancanti).toEqual([]);
  });

  // Il verso opposto: un'etichetta che nessuno usa è peso morto da tradurre.
  test.each(PAGINE)('%s: nessuna etichetta dichiarata e mai usata da %s', (file, script) => {
    const usate = chiaviUsateDa(script);
    const inutilizzate = Object.keys(etichetteDi(file, 'it')).filter((k) => !usate.includes(k));
    expect(inutilizzate).toEqual([]);
  });

  // I segnaposto sono un contratto fra template e codice: se una traduzione ne
  // scrive uno che il chiamante non passa, resta a schermo con le graffe.
  test.each(PAGINE)('%s: i segnaposto coincidono fra italiano e inglese', (file) => {
    const it = etichetteDi(file, 'it');
    const en = etichetteDi(file, 'en');
    const segnaposto = (s) => (String(s).match(/\{(\w+)\}/g) || []).sort();
    for (const chiave of Object.keys(it)) {
      expect({ chiave, segnaposto: segnaposto(en[chiave]) })
        .toEqual({ chiave, segnaposto: segnaposto(it[chiave]) });
    }
  });
});
