const fs = require('fs');
const os = require('os');
const path = require('path');
const json5 = require('json5');
const { setRuleAction, findRuleBlock, countBraces, describeDifference } = require('../../lib/rulesFileEditor');

let filePath;

/**
 * File di prova che riproduce ciò che rende difficile l'edit testuale: commenti
 * ovunque, una descrizione che contiene una graffa, e due regole con campi
 * `action` diversi.
 */
const SAMPLE = `// This file follows the JSON5 standard
//
// Intestazione con { una graffa } nel commento.
{
  schemaVersion: 1,

  rules: [

    // Commento sopra la prima regola: NON deve sparire.
    {
      name: "php-probe",
      enabled: true,
      category: "cms-probe",
      description: "Sonde .php — nota con { graffa } dentro la stringa",
      action: "monitor",
      match: {
        extension: ["php"],
      },
    },

    // Commento fra le due regole.
    {
      name: "backup-probe",
      enabled: true,
      category: "sensitive-file",
      description: "Dump e backup",
      action: "monitor",
      match: {
        extension: ["sql", "bak"],
      },
    },

  ],
}
`;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-editor-'));
  filePath = path.join(dir, 'sentinelRules.json5');
  fs.writeFileSync(filePath, SAMPLE, 'utf8');
});

afterEach(() => {
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

describe('countBraces', () => {
  test('ignora le graffe dentro le stringhe', () => {
    expect(countBraces('  description: "con { graffa }",')).toEqual({ open: 0, close: 0 });
  });

  test('ignora le graffe dentro i commenti di riga', () => {
    expect(countBraces('  // commento con { graffa }')).toEqual({ open: 0, close: 0 });
  });

  test('conta quelle vere', () => {
    expect(countBraces('    { name: "x" },')).toEqual({ open: 1, close: 1 });
    expect(countBraces('  match: {')).toEqual({ open: 1, close: 0 });
  });
});

describe('findRuleBlock', () => {
  test('individua l intervallo della regola giusta', () => {
    const lines = SAMPLE.split('\n');
    const block = findRuleBlock(lines, 'backup-probe');
    expect(block).not.toBeNull();
    const text = lines.slice(block.start, block.end + 1).join('\n');
    expect(text).toContain('backup-probe');
    expect(text).not.toContain('php-probe');
  });

  test('null se la regola non esiste', () => {
    expect(findRuleBlock(SAMPLE.split('\n'), 'inesistente')).toBeNull();
  });
});

describe('setRuleAction', () => {
  // Il motivo per cui questo modulo esiste invece di parse → stringify.
  test('preserva TUTTI i commenti del file', () => {
    setRuleAction(filePath, 'php-probe', 'block');
    const updated = fs.readFileSync(filePath, 'utf8');
    expect(updated).toContain('// This file follows the JSON5 standard');
    expect(updated).toContain('// Commento sopra la prima regola: NON deve sparire.');
    expect(updated).toContain('// Commento fra le due regole.');
    expect(updated).toContain('// Intestazione con { una graffa } nel commento.');
  });

  test('cambia solo la regola indicata', () => {
    setRuleAction(filePath, 'php-probe', 'block');
    const parsed = json5.parse(fs.readFileSync(filePath, 'utf8'));
    expect(parsed.rules[0].action).toBe('block');
    expect(parsed.rules[1].action).toBe('monitor');
  });

  test('funziona anche sulla seconda regola', () => {
    setRuleAction(filePath, 'backup-probe', 'block');
    const parsed = json5.parse(fs.readFileSync(filePath, 'utf8'));
    expect(parsed.rules[0].action).toBe('monitor');
    expect(parsed.rules[1].action).toBe('block');
  });

  test('restituisce l azione precedente', () => {
    const result = setRuleAction(filePath, 'php-probe', 'block');
    expect(result).toEqual({ changed: true, previous: 'monitor' });
  });

  test('è idempotente: riapplicare la stessa azione non tocca il file', () => {
    const before = fs.readFileSync(filePath, 'utf8');
    const result = setRuleAction(filePath, 'php-probe', 'monitor');
    expect(result.changed).toBe(false);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before);
  });

  // La retrocessione è il gesto che conta di più: deve funzionare come l'altro.
  test('retrocede da block a monitor', () => {
    setRuleAction(filePath, 'php-probe', 'block');
    setRuleAction(filePath, 'php-probe', 'monitor');
    expect(json5.parse(fs.readFileSync(filePath, 'utf8')).rules[0].action).toBe('monitor');
  });

  test('il file resta JSON5 valido dopo più modifiche', () => {
    setRuleAction(filePath, 'php-probe', 'block');
    setRuleAction(filePath, 'backup-probe', 'drop');
    setRuleAction(filePath, 'php-probe', 'monitor');
    expect(() => json5.parse(fs.readFileSync(filePath, 'utf8'))).not.toThrow();
  });
});

describe('setRuleAction — rifiuti', () => {
  test('azione sconosciuta', () => {
    expect(() => setRuleAction(filePath, 'php-probe', 'inventata')).toThrow(/azione non valida/);
  });

  test('regola inesistente', () => {
    expect(() => setRuleAction(filePath, 'non-esiste', 'block')).toThrow(/regola non trovata/);
  });

  test('un rifiuto NON tocca il file', () => {
    const before = fs.readFileSync(filePath, 'utf8');
    try { setRuleAction(filePath, 'non-esiste', 'block'); } catch (_e) { /* atteso */ }
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before);
  });
});

describe('describeDifference — la rete di sicurezza dell edit testuale', () => {
  test('nessuna differenza su strutture identiche', () => {
    expect(describeDifference({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toEqual([]);
  });

  test('individua il path esatto del campo cambiato', () => {
    const before = { rules: [{ name: 'x', action: 'monitor' }] };
    const after = { rules: [{ name: 'x', action: 'block' }] };
    expect(describeDifference(before, after)).toEqual(['rules[0].action']);
  });

  test('rileva più differenze quando ci sono', () => {
    const before = { rules: [{ action: 'monitor' }, { action: 'monitor' }] };
    const after = { rules: [{ action: 'block' }, { action: 'block' }] };
    expect(describeDifference(before, after)).toHaveLength(2);
  });
});
