/**
 * rulesFileManager.test.js
 *
 * ─── PERCHE QUESTO FILE ESISTE (revisione del plugin) ─────────────────────────
 * È il solo modulo di `adminSentinel` che SCRIVE e CANCELLA file — scrittura
 * atomica del file di regole, creazione dei backup, potatura dei vecchi — ed era
 * l'unico senza un test. Il modulo meno coperto era quello che può distruggere.
 *
 * La potatura in particolare esegue `unlinkSync` in ciclo su nomi ricavati da una
 * `readdir`: vale la pena che qualcuno verifichi, una volta per sempre, che
 * cancelli i più vecchi e non i più recenti.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const rulesFile = require('../../lib/rulesFileManager');

let ownFolder;
let rulesPath;

const backupDir = () => path.join(ownFolder, rulesFile.BACKUP_DIR_NAME);
const backupNames = () => fs.readdirSync(backupDir()).sort();

beforeEach(() => {
  ownFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-rules-'));
  rulesPath = path.join(ownFolder, 'sentinelRules.json5');
  fs.writeFileSync(rulesPath, '// commento\n{ rules: [] }\n', 'utf8');
});

afterEach(() => {
  fs.rmSync(ownFolder, { recursive: true, force: true });
});

describe('readRaw', () => {
  test('restituisce il testo COM È, commenti compresi', () => {
    const result = rulesFile.readRaw(rulesPath);
    expect(result.ok).toBe(true);
    expect(result.content).toBe('// commento\n{ rules: [] }\n');
    expect(result.error).toBeNull();
  });

  test('porta l mtime, che è la precondizione della guardia sul salvataggio', () => {
    const result = rulesFile.readRaw(rulesPath);
    expect(Number.isNaN(Date.parse(result.mtime))).toBe(false);
  });

  test('un file assente è un esito, non un lancio', () => {
    const result = rulesFile.readRaw(path.join(ownFolder, 'non-esiste.json5'));
    expect(result.ok).toBe(false);
    expect(result.content).toBe('');
    expect(typeof result.error).toBe('string');
  });
});

describe('currentMtime', () => {
  test('coincide con quello riportato dalla lettura completa', () => {
    expect(rulesFile.currentMtime(rulesPath)).toBe(rulesFile.readRaw(rulesPath).mtime);
  });

  test('cambia quando il file viene riscritto', () => {
    const prima = rulesFile.currentMtime(rulesPath);
    // L mtime ha granularità al millisecondo: si forza una data diversa invece
    // di sperare che la riscrittura cada in un millisecondo successivo.
    const dopo = new Date(Date.now() + 5000);
    fs.utimesSync(rulesPath, dopo, dopo);
    expect(rulesFile.currentMtime(rulesPath)).not.toBe(prima);
  });

  test('un file assente dà null, non lancia', () => {
    expect(rulesFile.currentMtime(path.join(ownFolder, 'non-esiste.json5'))).toBeNull();
  });
});

describe('writeRaw', () => {
  test('scrive il testo esattamente come arriva', () => {
    const testo = '// mio commento\n{\n  rules: [ /* niente */ ],\n}\n';
    expect(rulesFile.writeRaw(rulesPath, testo)).toEqual({ ok: true, error: null });
    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(testo);
  });

  test('non lascia il file temporaneo dietro di sé', () => {
    rulesFile.writeRaw(rulesPath, '{}');
    expect(fs.readdirSync(ownFolder).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  // Il percorso che l'interfaccia riportava come «non valido» senza spiegare
  // niente: un errore di scrittura non è un errore di validazione.
  test('un errore di scrittura torna come esito con il motivo', () => {
    const impossibile = path.join(ownFolder, 'cartella-che-non-esiste', 'regole.json5');
    const result = rulesFile.writeRaw(impossibile, '{}');
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
  });

  test('se la scrittura fallisce, il file precedente resta intatto', () => {
    const originale = fs.readFileSync(rulesPath, 'utf8');
    // Una directory al posto del file temporaneo: la scrittura fallisce, e ciò
    // che conta è che il file di regole non sia stato toccato.
    fs.mkdirSync(rulesPath + '.tmp');
    const result = rulesFile.writeRaw(rulesPath, 'nuovo contenuto');
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(originale);
  });
});

describe('createBackup', () => {
  test('copia il file corrente e ne riporta il nome', () => {
    const result = rulesFile.createBackup(rulesPath, ownFolder, 10);
    expect(result.ok).toBe(true);
    expect(result.file).toMatch(/^sentinelRules\..*\.json5$/);
    expect(fs.readFileSync(path.join(backupDir(), result.file), 'utf8'))
      .toBe('// commento\n{ rules: [] }\n');
  });

  test('un file di regole ancora inesistente non è un errore', () => {
    const result = rulesFile.createBackup(
      path.join(ownFolder, 'mai-scritto.json5'), ownFolder, 10);
    expect(result).toEqual({ ok: true, file: null, error: null });
  });

  // Fail-soft dichiarato: bloccare una correzione urgente perché non si può
  // archiviare la versione rotta sarebbe il peggiore dei compromessi.
  test('un backup impossibile non impedisce di proseguire', () => {
    const bloccato = path.join(ownFolder, 'file-al-posto-della-cartella');
    fs.writeFileSync(bloccato, 'non sono una cartella', 'utf8');
    const result = rulesFile.createBackup(rulesPath, bloccato, 10);
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
  });
});

describe('pruneBackups', () => {
  /** Nomi con timestamp crescente: l ordine lessicografico è quello cronologico. */
  function seedBackups(quanti) {
    fs.mkdirSync(backupDir(), { recursive: true });
    const nomi = [];
    for (let i = 0; i < quanti; i++) {
      const nome = `sentinelRules.2026-08-16T10-00-${String(i).padStart(2, '0')}-000Z.json5`;
      fs.writeFileSync(path.join(backupDir(), nome), `versione ${i}`, 'utf8');
      nomi.push(nome);
    }
    return nomi;
  }

  test('tiene i più recenti e cancella i più vecchi', () => {
    const nomi = seedBackups(15);
    rulesFile.pruneBackups(backupDir(), 10);

    const rimasti = backupNames();
    expect(rimasti).toHaveLength(10);
    expect(rimasti).toEqual(nomi.slice(5));      // i 10 più recenti
    expect(rimasti).not.toContain(nomi[0]);      // il più vecchio è andato
  });

  test('sotto il tetto non cancella niente', () => {
    const nomi = seedBackups(3);
    rulesFile.pruneBackups(backupDir(), 10);
    expect(backupNames()).toEqual(nomi);
  });

  test('un tetto assente o assurdo ricade su dieci', () => {
    seedBackups(12);
    rulesFile.pruneBackups(backupDir(), undefined);
    expect(backupNames()).toHaveLength(10);
  });

  test('una cartella inesistente non fa lanciare nulla', () => {
    expect(() => rulesFile.pruneBackups(path.join(ownFolder, 'mai-creata'), 10)).not.toThrow();
  });

  // Il tetto vale su ogni salvataggio, non solo alla potatura esplicita.
  test('createBackup applica il tetto da sé', () => {
    for (let i = 0; i < 6; i++) {
      fs.writeFileSync(rulesPath, `{ versione: ${i} }`, 'utf8');
      rulesFile.createBackup(rulesPath, ownFolder, 3);
    }
    expect(backupNames().length).toBeLessThanOrEqual(3);
  });
});

describe('listBackups', () => {
  test('elenca dal più recente, con dimensione e data', () => {
    fs.mkdirSync(backupDir(), { recursive: true });
    for (const stamp of ['2026-08-01T00-00-00-000Z', '2026-08-02T00-00-00-000Z']) {
      fs.writeFileSync(path.join(backupDir(), `sentinelRules.${stamp}.json5`), 'x', 'utf8');
    }
    const elenco = rulesFile.listBackups(ownFolder);
    expect(elenco.map((b) => b.file)).toEqual([
      'sentinelRules.2026-08-02T00-00-00-000Z.json5',
      'sentinelRules.2026-08-01T00-00-00-000Z.json5',
    ]);
    expect(elenco[0].size).toBe(1);
    expect(Number.isNaN(Date.parse(elenco[0].mtime))).toBe(false);
  });

  test('senza cartella dei backup l elenco è vuoto, non un errore', () => {
    expect(rulesFile.listBackups(ownFolder)).toEqual([]);
  });

  test('ignora i file estranei alla cartella dei backup', () => {
    fs.mkdirSync(backupDir(), { recursive: true });
    fs.writeFileSync(path.join(backupDir(), 'sentinelRules.2026-08-01T00-00-00-000Z.json5'), 'x');
    fs.writeFileSync(path.join(backupDir(), 'appunti.txt'), 'x');
    expect(rulesFile.listBackups(ownFolder).map((b) => b.file))
      .toEqual(['sentinelRules.2026-08-01T00-00-00-000Z.json5']);
  });
});
