const fs = require('fs');
const os = require('os');
const path = require('path');
const json5 = require('json5');
const {
  setRuleAction, replaceRule, serializeRule,
  findRuleBlock, countBraces, scanBraces, describeDifference,
} = require('../../lib/rulesFileEditor');

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

  // JSON5 ammette entrambe le forme di commento, e questa mancava: una graffa
  // dentro `/* */` sbilanciava il conteggio, e da lì la ricerca del blocco
  // finiva altrove. Falliva in modo sicuro — la verifica differenziale annulla
  // la scrittura — ma con un messaggio che dà la colpa al file sbagliato.
  test('ignora le graffe dentro un commento a blocco sulla stessa riga', () => {
    expect(countBraces('  /* nota con { graffa } */')).toEqual({ open: 0, close: 0 });
  });

  test('conta ciò che sta FUORI dal commento a blocco, sulla stessa riga', () => {
    expect(countBraces('  /* nota { */ match: {')).toEqual({ open: 1, close: 0 });
  });
});

describe('scanBraces — lo stato che attraversa le righe', () => {
  test('un commento a blocco su più righe non sbilancia il conteggio', () => {
    const lines = [
      '{',
      '  /* apertura del commento {',
      '     ancora dentro } e }',
      '     chiusura */',
      '}',
    ];
    const profile = scanBraces(lines);
    const totale = profile.reduce((acc, r) => acc + r.open - r.close, 0);
    expect(totale).toBe(0);
    expect(profile[2].commented).toBe(true);
    expect(profile[4].commented).toBe(false);
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

  test('non si fa ingannare da una regola commentata a blocco con lo stesso nome', () => {
    // Commentare una regola per metterla da parte è la cosa più naturale del
    // mondo, e con `/* */` la sua riga `name:` è identica a quella vera. Se la
    // ricerca si fermasse lì, il salvataggio riscriverebbe del testo commentato:
    // la GUI direbbe «salvato» e la regola in vigore resterebbe com'era.
    const withCommented = [
      '{',
      '  rules: [',
      '    /* messa da parte per ora',
      '    {',
      '      name: "php-probe",',
      '      action: "block",',
      '    },',
      '    */',
      '    {',
      '      name: "php-probe",',
      '      action: "monitor",',
      '    },',
      '  ],',
      '}',
    ];
    const block = findRuleBlock(withCommented, 'php-probe');
    expect(block).not.toBeNull();
    const text = withCommented.slice(block.start, block.end + 1).join('\n');
    expect(text).toContain('"monitor"');
    expect(text).not.toContain('"block"');
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

  // Il caso completo del difetto sui commenti a blocco: prima la promozione
  // falliva con «blocco testuale non individuabile» su un file perfettamente
  // valido, e l'amministratore non aveva modo di capire che la colpa era di una
  // graffa dentro un `/* */` scritto mesi prima.
  test('promuove anche su un file che usa commenti a blocco', () => {
    const withBlockComments = SAMPLE.replace(
      '    // Commento fra le due regole.',
      '    /* Commento fra le due regole,\n       con una { graffa } spaiata dentro. */',
    );
    fs.writeFileSync(filePath, withBlockComments, 'utf8');

    expect(() => setRuleAction(filePath, 'backup-probe', 'block')).not.toThrow();

    const updated = fs.readFileSync(filePath, 'utf8');
    const parsed = json5.parse(updated);
    expect(parsed.rules[1].action).toBe('block');
    expect(parsed.rules[0].action).toBe('monitor');   // l'altra non è stata toccata
    expect(updated).toContain('con una { graffa } spaiata dentro.');
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

// ─────────────────────────────────────────────────────────────────────────────
// SOSTITUZIONE DI UNA REGOLA INTERA (Vista C)
// ─────────────────────────────────────────────────────────────────────────────

describe('serializeRule', () => {
  test('scrive le chiavi in ordine stabile, non in quello dell\'oggetto', () => {
    // Senza un ordine fisso, due salvataggi identici produrrebbero diff diversi
    // e il file diventerebbe illeggibile nel controllo di versione.
    const testo = serializeRule({
      action: 'block', name: 'x', match: { path: '/a' }, enabled: true,
    });
    const chiavi = testo.match(/^\s+(\w+):/gm).map((s) => s.trim().replace(':', ''));
    expect(chiavi.slice(0, 4)).toEqual(['name', 'enabled', 'action', 'match']);
  });

  test('produce JSON5 valido, riparsabile', () => {
    const rule = {
      name: 'x', enabled: true, action: 'decoy',
      description: 'con "virgolette" e { graffe }',
      match: { extension: ['php'], fingerprintClass: { coherent: false } },
      decoy: { file: 'a.html', status: 200, headers: { 'X-Powered-By': 'PHP/7.4' } },
    };
    expect(json5.parse(`[${serializeRule(rule)}]`)[0]).toEqual(rule);
  });

  test('una chiave non prevista viene conservata, non persa', () => {
    // Quasi sempre è un refuso, ma cancellarla in silenzio è peggio che
    // lasciarla dov'è e farla vedere.
    const testo = serializeRule({ name: 'x', action: 'monitor', match: { path: '/a' }, chiaveStrana: 42 });
    expect(json5.parse(`[${testo}]`)[0].chiaveStrana).toBe(42);
  });

  test('rispetta il rientro richiesto', () => {
    expect(serializeRule({ name: 'x' }, 6).startsWith('      {')).toBe(true);
  });
});

describe('replaceRule', () => {
  const leggi = () => json5.parse(fs.readFileSync(filePath, 'utf8'));
  const testo = () => fs.readFileSync(filePath, 'utf8');

  test('sostituisce solo la regola indicata', () => {
    replaceRule(filePath, 'php-probe', {
      name: 'php-probe', enabled: false, category: 'cms-probe',
      description: 'riscritta dal form', action: 'block',
      match: { extension: ['php', 'phtml'] },
    });

    const dopo = leggi();
    expect(dopo.rules[0]).toEqual({
      name: 'php-probe', enabled: false, category: 'cms-probe',
      description: 'riscritta dal form', action: 'block',
      match: { extension: ['php', 'phtml'] },
    });
    // La seconda regola non è stata sfiorata.
    expect(dopo.rules[1].description).toBe('Dump e backup');
    expect(dopo.rules).toHaveLength(2);
  });

  test('i commenti FUORI dalla regola sopravvivono', () => {
    replaceRule(filePath, 'php-probe', {
      name: 'php-probe', action: 'block', match: { extension: ['php'] },
    });
    const t = testo();
    expect(t).toContain('// This file follows the JSON5 standard');
    expect(t).toContain('// Intestazione con { una graffa } nel commento.');
    expect(t).toContain('// Commento sopra la prima regola: NON deve sparire.');
    expect(t).toContain('// Commento fra le due regole.');
  });

  test('funziona anche sull\'ultima regola del file', () => {
    // Il caso limite dell'edit testuale: sbagliare la fine del blocco qui
    // mangerebbe la chiusura dell'array.
    replaceRule(filePath, 'backup-probe', {
      name: 'backup-probe', action: 'block', match: { extension: ['sql'] },
    });
    expect(leggi().rules).toHaveLength(2);
    expect(leggi().rules[1].action).toBe('block');
  });

  test('rinominare è rifiutato', () => {
    // Il nome lega contatori, righe di log e promozioni: cambiarlo dal form
    // azzererebbe la storia della regola senza che nessuno se ne accorga.
    const prima = testo();
    expect(() => replaceRule(filePath, 'php-probe', { name: 'altro-nome', action: 'block', match: { path: '/a' } }))
      .toThrow(/nome di una regola non si cambia/);
    expect(testo()).toBe(prima);
  });

  test('una regola inesistente è rifiutata senza toccare il file', () => {
    const prima = testo();
    expect(() => replaceRule(filePath, 'mai-vista', { name: 'mai-vista', action: 'block', match: { path: '/a' } }))
      .toThrow(/non trovata/);
    expect(testo()).toBe(prima);
  });

  test('il risultato è riparsabile e le altre regole sono identiche', () => {
    const prima = leggi();
    replaceRule(filePath, 'php-probe', {
      name: 'php-probe', action: 'tarpit', match: { extension: ['php'] }, tarpit: { seconds: 15 },
    });
    const dopo = leggi();
    expect(dopo.rules[1]).toEqual(prima.rules[1]);
    expect(dopo.schemaVersion).toBe(prima.schemaVersion);
  });

  test('due sostituzioni consecutive non degradano il file', () => {
    replaceRule(filePath, 'php-probe', { name: 'php-probe', action: 'block', match: { extension: ['php'] } });
    replaceRule(filePath, 'php-probe', { name: 'php-probe', action: 'monitor', match: { extension: ['php'] } });
    replaceRule(filePath, 'backup-probe', { name: 'backup-probe', action: 'block', match: { extension: ['sql'] } });

    const dopo = leggi();
    expect(dopo.rules.map((r) => r.name)).toEqual(['php-probe', 'backup-probe']);
    expect(testo()).toContain('// Commento fra le due regole.');
  });

  test('conserva la virgola finale del blocco', () => {
    // Senza, il file resterebbe sintatticamente valido solo per caso.
    replaceRule(filePath, 'php-probe', { name: 'php-probe', action: 'block', match: { extension: ['php'] } });
    expect(() => leggi()).not.toThrow();
  });
});
