/**
 * insertRuleText.test.js
 *
 * L'inserimento testuale di una regola usato dalle migrazioni.
 *
 * È codice che modifica un file strutturato manipolandone il TESTO, cioè la
 * categoria di operazione che sbaglia in silenzio: un'espressione regolare che
 * colpisce la riga sbagliata produce un file che sembra giusto. Le tre cose che
 * questi test difendono:
 *
 *   1. LA POSIZIONE. Accodare invece che inserire in testa non dà nessun errore,
 *      e con first-match-wins rende la regola inefficace su metà dei casi.
 *   2. I COMMENTI. Sono la ragione per cui non si usa `setJson5Key` sull'array:
 *      se sparissero, la migrazione farebbe più danni del problema che risolve.
 *   3. IL RIFIUTO. Davanti a qualcosa di inatteso il file non va toccato.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const JSON5 = require('json5');

const { insertRule, resolveSkip } = require('../../migrations/insertRuleText');

const FILE_BASE = `// commento di testa del file
{
  schemaVersion: 1,

  rules: [

    // ─── WHITELIST ───
    {
      name: "allow-loopback",
      enabled: false,
      action: "allow",
      match: { ip: ["127.0.0.0/8"] },
    },

    // ─── FILE SENSIBILI ───
    {
      name: "backup-probe",
      // un commento con una graffa } dentro, per far inciampare i conteggi ingenui
      description: "cerca dump { e backup }",
      action: "monitor",
      match: { extension: ["gz"] },
    },

    {
      name: "php-probe",
      action: "monitor",
      match: { extension: ["php"] },
    },

  ],
}
`;

const NUOVA = `    // ─── TOKEN ESCA ───
    {
      name: "canary-token-used",
      action: "monitor",
      match: { canary: true },
    },

`;

let sandbox;
let filePath;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-migr-'));
  filePath = path.join(sandbox, 'sentinelRules.json5');
  fs.writeFileSync(filePath, FILE_BASE, 'utf8');
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const nomi = () => JSON5.parse(fs.readFileSync(filePath, 'utf8')).rules.map((r) => r.name);
const commenti = () => fs.readFileSync(filePath, 'utf8').split('//').length - 1;

// ─────────────────────────────────────────────────────────────────────────────
describe('posizione dell\'inserimento', () => {
  test('la regola va dopo la whitelist, non in fondo', () => {
    // Accodarla la metterebbe dopo `backup-probe`, che matcha .tar.gz: un canary
    // consegnato dentro un finto backup non arriverebbe mai alla propria regola.
    const outcome = insertRule(filePath, NUOVA, 'canary-token-used');

    expect(outcome.applied).toBe(true);
    expect(nomi()).toEqual(['allow-loopback', 'canary-token-used', 'backup-probe', 'php-probe']);
  });

  test('con afterRule va subito dopo la regola nominata', () => {
    insertRule(filePath, NUOVA, 'canary-token-used');
    insertRule(filePath, '    {\n      name: "session-hijack-signal",\n      action: "monitor",\n      match: { sessionAnomaly: true },\n    },\n\n',
      'session-hijack-signal', { afterRule: 'canary-token-used' });

    expect(nomi()).toEqual([
      'allow-loopback', 'canary-token-used', 'session-hijack-signal', 'backup-probe', 'php-probe',
    ]);
  });

  test('senza afterRule il secondo inserimento finirebbe SOPRA il primo', () => {
    // Documenta il motivo per cui l'ancora esiste: è la differenza fra un
    // ordine identico a quello distribuito e uno invertito.
    insertRule(filePath, NUOVA, 'canary-token-used');
    insertRule(filePath, '    {\n      name: "altra",\n      action: "monitor",\n      match: { path: "/x" },\n    },\n\n', 'altra');

    expect(nomi()[1]).toBe('altra');
    expect(nomi()[2]).toBe('canary-token-used');
  });

  test('un file con più allow iniziali li salta tutti', () => {
    const conDueAllow = FILE_BASE.replace('    // ─── FILE SENSIBILI ───',
      '    {\n      name: "allow-monitoraggio",\n      action: "allow",\n      match: { ip: ["10.0.0.0/8"] },\n    },\n\n    // ─── FILE SENSIBILI ───');
    fs.writeFileSync(filePath, conDueAllow, 'utf8');

    insertRule(filePath, NUOVA, 'canary-token-used');
    expect(nomi()).toEqual([
      'allow-loopback', 'allow-monitoraggio', 'canary-token-used', 'backup-probe', 'php-probe',
    ]);
  });

  test('un file senza allow riceve la regola in prima posizione', () => {
    const senzaAllow = { schemaVersion: 1, rules: [{ name: 'php-probe', action: 'monitor', match: { extension: ['php'] } }] };
    fs.writeFileSync(filePath, JSON5.stringify(senzaAllow, null, 2), 'utf8');

    insertRule(filePath, NUOVA, 'canary-token-used');
    expect(nomi()).toEqual(['canary-token-used', 'php-probe']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('i commenti sopravvivono', () => {
  test('nessun commento preesistente viene perso', () => {
    // È la ragione per cui non si usa setJson5Key sull'array: quello
    // riscriverebbe `rules` da una serializzazione, cancellando le cornici di
    // sezione e le descrizioni.
    const prima = commenti();
    insertRule(filePath, NUOVA, 'canary-token-used');

    const testo = fs.readFileSync(filePath, 'utf8');
    expect(commenti()).toBeGreaterThan(prima);
    expect(testo).toContain('// commento di testa del file');
    expect(testo).toContain('// ─── WHITELIST ───');
    expect(testo).toContain('// ─── FILE SENSIBILI ───');
    expect(testo).toContain('un commento con una graffa } dentro');
  });

  test('il resto del file resta byte per byte identico', () => {
    const prima = fs.readFileSync(filePath, 'utf8');
    insertRule(filePath, NUOVA, 'canary-token-used');
    const dopo = fs.readFileSync(filePath, 'utf8');

    expect(dopo.replace(NUOVA, '')).toBe(prima);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('idempotenza e rifiuti', () => {
  test('una regola già presente non viene reinserita', () => {
    insertRule(filePath, NUOVA, 'canary-token-used');
    const dopoPrimo = fs.readFileSync(filePath, 'utf8');

    const secondo = insertRule(filePath, NUOVA, 'canary-token-used');
    expect(secondo.applied).toBe(false);
    expect(secondo.reason).toBe('già presente');
    expect(fs.readFileSync(filePath, 'utf8')).toBe(dopoPrimo);
  });

  test('dry-run non tocca il file', () => {
    const prima = fs.readFileSync(filePath, 'utf8');
    const outcome = insertRule(filePath, NUOVA, 'canary-token-used', { dryRun: true });

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe('dry-run');
    expect(fs.readFileSync(filePath, 'utf8')).toBe(prima);
  });

  test('un file assente non è un errore fatale', () => {
    const outcome = insertRule(path.join(sandbox, 'inesistente.json5'), NUOVA, 'x');
    expect(outcome).toEqual({ applied: false, reason: 'file assente' });
  });

  test('un file JSON5 rotto viene rifiutato senza essere toccato', () => {
    fs.writeFileSync(filePath, '{ rules: [ { name: "rotta" ', 'utf8');
    const prima = fs.readFileSync(filePath, 'utf8');

    expect(() => insertRule(filePath, NUOVA, 'canary-token-used')).toThrow(/non è JSON5 valido/);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(prima);
  });

  test('un testo di regola malformato non lascia il file a metà', () => {
    // La verifica differenziale gira PRIMA della scrittura: se l'inserimento
    // producesse JSON5 non valido, il file vero non viene mai aperto in
    // scrittura.
    const prima = fs.readFileSync(filePath, 'utf8');
    expect(() => insertRule(filePath, '    { name: "monca", \n', 'monca')).toThrow();
    expect(fs.readFileSync(filePath, 'utf8')).toBe(prima);
  });

  test('un testo che dichiara un nome diverso da quello atteso è rifiutato', () => {
    // Protegge dal copia-incolla sbagliato in uno script di migrazione: il nome
    // usato per l'idempotenza e quello scritto nel testo devono coincidere, o
    // la migrazione si riapplicherebbe a ogni esecuzione.
    const prima = fs.readFileSync(filePath, 'utf8');
    expect(() => insertRule(filePath, NUOVA, 'nome-che-non-corrisponde')).toThrow(/ordine delle regole/);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(prima);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('resolveSkip', () => {
  const rules = [
    { name: 'a', action: 'allow' },
    { name: 'b', action: 'allow' },
    { name: 'c', action: 'monitor' },
    { name: 'd', action: 'block' },
  ];

  test('salta il blocco iniziale di allow', () => {
    expect(resolveSkip(rules, undefined)).toBe(2);
  });

  test('con afterRule va dopo quella regola', () => {
    expect(resolveSkip(rules, 'c')).toBe(3);
  });

  test('un afterRule inesistente ricade sulla whitelist', () => {
    expect(resolveSkip(rules, 'mai-vista')).toBe(2);
  });

  test('un afterRule dentro la whitelist non arretra la posizione', () => {
    expect(resolveSkip(rules, 'a')).toBe(2);
  });
});
