/**
 * Unit Tests: core/renameJson5Key.js — la sesta operazione dello strato JSON5.
 *
 * ─── COSA PRESIDIANO, E PERCHE PROPRIO QUESTI CASI ────────────────────────────
 * Stessa storia della quinta operazione, e stessa morale. Questa funzione
 * esisteva già, scritta a mano dentro `from-v3-to-v4.js` con `String.replace`,
 * e ne sono usciti DUE difetti che 21 test verdi non avevano colto — perché
 * provavano lo script contro il file da cui era stato scritto.
 *
 * I primi test sono quindi le forme su cui `replace` sbagliava, e sono i più
 * importanti del file:
 *
 *   • ANCORA DENTRO UN COMMENTO → `replace` non distingue codice da commento e
 *     cambia la prima occorrenza che trova. Una regola commentata per
 *     disabilitarla — il modo naturale di disabilitarla — veniva riscritta al
 *     posto della regola vera, che restava letterale. Con il log che dichiarava
 *     successo.
 *   • STESSA CHIAVE IN DUE BLOCCHI → `replace` con un pattern stringa sostituisce
 *     solo la PRIMA occorrenza, e la guardia « già convertito » poi mascherava il
 *     residuo per sempre.
 *
 * Poi la COLLISIONE, che è il modo in cui questa operazione può perdere dati per
 * conto proprio: due chiavi omonime sono JSON5 valido, e `json5.parse` ne terrebbe
 * una sola, in silenzio.
 *
 * → docs/decisions/json5-key-operations.it.md
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const json5 = require('json5');

const renameJson5Key = require('../../../core/renameJson5Key');

function sandbox(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-mvkey-'));
  const file = path.join(dir, 'config.json5');
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

const read = (file) => fs.readFileSync(file, 'utf8');
const parse = (file) => json5.parse(read(file));

// ─────────────────────────────────────────────────────────────────────────────
// Le forme su cui String.replace sbagliava
// ─────────────────────────────────────────────────────────────────────────────

describe('le forme su cui String.replace sbagliava', () => {
  test("un'ancora dentro un COMMENTO non viene toccata", async () => {
    const file = sandbox(`{
  // esempio, per riferimento:  "/admin": { "requiresAuth": true }
  "rules": {
    "/admin": { "requiresAuth": true }
  }
}
`);
    const out = await renameJson5Key(file, ['rules', '/admin'], '{{admin}}');

    expect(out.changed).toBe(true);
    // il commento è intatto, carattere per carattere
    expect(read(file)).toContain('// esempio, per riferimento:  "/admin": { "requiresAuth": true }');
    // e la chiave VERA è rinominata
    expect(Object.keys(parse(file).rules)).toEqual(['{{admin}}']);
  });

  test('una chiave che vive SOLO in un commento non esiste: no-op', async () => {
    // Il contrario del caso sopra, e deve dare `changed: false` invece di
    // riscrivere il commento. `replace` lo riscriveva.
    const file = sandbox(`{
  // "/admin": { "requiresAuth": true }
  "rules": {}
}
`);
    const before = read(file);
    const out = await renameJson5Key(file, ['rules', '/admin'], '{{admin}}');

    expect(out.changed).toBe(false);
    expect(read(file)).toBe(before);
  });

  test('la stessa chiave in DUE blocchi: ciascuna è un bersaglio distinto', async () => {
    // L'ordine dei blocchi è INVERTITO di proposito: `customRules` viene prima
    // nel testo, ma si rinomina prima quella di `hardcodedRules`. Una ricerca
    // testuale colpirebbe la PRIMA occorrenza, cioè il blocco sbagliato — ed è
    // ciò che rende questo test discriminante invece che fortunato.
    const file = sandbox(`{
  "customRules": {
    "/admin/**": { "allowedRoles": [0] }
  },
  "hardcodedRules": {
    "/admin/**": { "allowedRoles": [0, 1] }
  }
}
`);
    await renameJson5Key(file, ['hardcodedRules', '/admin/**'], '{{admin}}/**');
    await renameJson5Key(file, ['customRules', '/admin/**'], '{{admin}}/**');

    const parsed = parse(file);
    expect(Object.keys(parsed.hardcodedRules)).toEqual(['{{admin}}/**']);
    expect(Object.keys(parsed.customRules)).toEqual(['{{admin}}/**']);
    // i valori non si confondono
    expect(parsed.hardcodedRules['{{admin}}/**'].allowedRoles).toEqual([0, 1]);
    expect(parsed.customRules['{{admin}}/**'].allowedRoles).toEqual([0]);
  });

  test('una chiave dentro una STRINGA non viene confusa con la chiave', async () => {
    const file = sandbox(`{
  "nota": "la regola \\"/admin\\" va rivista",
  "rules": {
    "/admin": { "requiresAuth": true }
  }
}
`);
    await renameJson5Key(file, ['rules', '/admin'], '{{admin}}');

    expect(parse(file).nota).toBe('la regola "/admin" va rivista');
    expect(Object.keys(parse(file).rules)).toEqual(['{{admin}}']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Collisione: il modo in cui questa operazione potrebbe perdere dati
// ─────────────────────────────────────────────────────────────────────────────

describe('collisione', () => {
  test('rifiuta se la chiave nuova esiste GIÀ nello stesso blocco', async () => {
    // Due chiavi omonime sono JSON5 valido: `json5.parse` terrebbe solo
    // l'ultima, e il valore dell'altra sparirebbe senza alcun errore.
    const file = sandbox(`{
  "rules": {
    "/admin": { "allowedRoles": [0, 1] },
    "{{admin}}": { "allowedRoles": [0] }
  }
}
`);
    const before = read(file);

    await expect(renameJson5Key(file, ['rules', '/admin'], '{{admin}}'))
      .rejects.toThrow(/esiste gi/);
    expect(read(file)).toBe(before);
  });

  test('NON è una collisione se la chiave nuova vive in un ALTRO blocco', async () => {
    const file = sandbox(`{
  "altro": { "{{admin}}": 1 },
  "rules": { "/admin": { "allowedRoles": [0] } }
}
`);
    const out = await renameJson5Key(file, ['rules', '/admin'], '{{admin}}');

    expect(out.changed).toBe(true);
    expect(Object.keys(parse(file).rules)).toEqual(['{{admin}}']);
    expect(parse(file).altro['{{admin}}']).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Preservazione
// ─────────────────────────────────────────────────────────────────────────────

describe('preserva tutto ciò che non è la chiave', () => {
  test('commenti, posizione, valore e formattazione restano', async () => {
    const file = sandbox(`// This file follows the JSON5 standard
{
  "schemaVersion": 3,
  "rules": {
    // il pannello: protetto per costruzione
    "/admin": {
      "requiresAuth": true,   // nessun anonimo
      "allowedRoles": [0, 1], // root e admin
    },
    "/altro": { "requiresAuth": false },
  },
}
`);
    await renameJson5Key(file, ['rules', '/admin'], '{{admin}}');
    const after = read(file);

    expect(after).toContain('// This file follows the JSON5 standard');
    expect(after).toContain('// il pannello: protetto per costruzione');
    expect(after).toContain('"requiresAuth": true,   // nessun anonimo');
    expect(after).toContain('"allowedRoles": [0, 1], // root e admin');
    // la POSIZIONE: resta la prima delle due, non si sposta in coda
    expect(Object.keys(parse(file).rules)).toEqual(['{{admin}}', '/altro']);
  });

  test('una chiave NON QUOTATA esce quotata', async () => {
    // Stessa normalizzazione che `editJson5` applica a ciò che riscrive, e qui è
    // necessaria: un nome come `{{admin}}/**` non è un identificatore valido.
    const file = sandbox('{\n  vecchia: 1,\n}\n');
    await renameJson5Key(file, 'vecchia', 'nuova');

    expect(read(file)).toContain('"nuova": 1,');
    expect(parse(file)).toEqual({ nuova: 1 });
  });

  test('funziona su una chiave TOP-LEVEL', async () => {
    const file = sandbox('{\n  // nota\n  "a": { "b": 2 },\n}\n');
    const out = await renameJson5Key(file, 'a', 'z');

    expect(out).toEqual({ changed: true, oldKey: 'a' });
    expect(read(file)).toContain('// nota');
    expect(parse(file)).toEqual({ z: { b: 2 } });
  });

  test('funziona su un path ANNIDATO di tre segmenti', async () => {
    const file = sandbox('{\n  "a": {\n    "b": {\n      // nota di c\n      "c": 3,\n    },\n  },\n}\n');
    await renameJson5Key(file, ['a', 'b', 'c'], 'd');

    expect(read(file)).toContain('// nota di c');
    expect(parse(file).a.b).toEqual({ d: 3 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Contratto
// ─────────────────────────────────────────────────────────────────────────────

describe('contratto', () => {
  test('chiave assente → no-op idempotente, non un errore', async () => {
    const file = sandbox('{\n  "a": 1,\n}\n');
    const before = read(file);
    const out = await renameJson5Key(file, 'inesistente', 'nuova');

    expect(out).toEqual({ changed: false, oldKey: 'inesistente' });
    expect(read(file)).toBe(before);
  });

  test('la seconda esecuzione della stessa rinomina è un no-op', async () => {
    const file = sandbox('{\n  "a": 1,\n}\n');
    expect((await renameJson5Key(file, 'a', 'z')).changed).toBe(true);
    expect((await renameJson5Key(file, 'a', 'z')).changed).toBe(false);
    expect(parse(file)).toEqual({ z: 1 });
  });

  test('newKey uguale a oldKey → no-op, non una collisione con se stessa', async () => {
    const file = sandbox('{\n  "a": 1,\n}\n');
    const before = read(file);
    const out = await renameJson5Key(file, 'a', 'a');

    expect(out.changed).toBe(false);
    expect(read(file)).toBe(before);
  });

  test('path AMBIGUO → rifiuto (eredita la severità di locatePath)', async () => {
    const file = sandbox('{\n  "a": 1,\n  "a": 2,\n}\n');
    await expect(renameJson5Key(file, 'a', 'z')).rejects.toThrow(/appears 2 times|ambigu/i);
  });

  test('un path che passa per un ARRAY non è navigabile → no-op', async () => {
    const file = sandbox('{\n  "list": [ { "a": 1 } ],\n}\n');
    const before = read(file);
    const out = await renameJson5Key(file, ['list', 'a'], 'z');

    expect(out.changed).toBe(false);
    expect(read(file)).toBe(before);
  });

  test('argomenti non validi → lancia', async () => {
    const file = sandbox('{\n  "a": 1,\n}\n');
    await expect(renameJson5Key('', 'a', 'z')).rejects.toThrow(/filePath/);
    await expect(renameJson5Key(file, '', 'z')).rejects.toThrow(/fieldName/);
    await expect(renameJson5Key(file, [], 'z')).rejects.toThrow(/at least one segment/);
    await expect(renameJson5Key(file, ['a', 1], 'z')).rejects.toThrow(/every path segment/);
    await expect(renameJson5Key(file, 42, 'z')).rejects.toThrow(/second argument/);
    await expect(renameJson5Key(file, 'a', '')).rejects.toThrow(/newKey/);
    await expect(renameJson5Key(file, 'a', null)).rejects.toThrow(/newKey/);
  });

  test('file non JSON5 valido, o radice non oggetto → lancia', async () => {
    const broken = sandbox('{ "a": }\n');
    await expect(renameJson5Key(broken, 'a', 'z')).rejects.toThrow(/not valid JSON5/);

    const arrayRoot = sandbox('[1, 2, 3]\n');
    await expect(renameJson5Key(arrayRoot, 'a', 'z')).rejects.toThrow(/not a JSON5 object/);
  });

  test('il lookup passa da hasOwnProperty: `constructor` non esiste', async () => {
    // Senza il controllo, un segmento che nomina una proprietà del PROTOTIPO
    // pescherebbe un valore truthy e farebbe credere che la chiave esista
    // (REVIEW.md → B4).
    const file = sandbox('{\n  "a": 1,\n}\n');
    const out = await renameJson5Key(file, 'constructor', 'z');
    expect(out.changed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Postcondizione
// ─────────────────────────────────────────────────────────────────────────────

describe('postcondizione: cambia SOLO il nome della chiave', () => {
  test('il valore arriva intatto alla chiave nuova', async () => {
    const file = sandbox(`{
  "a": {
    "annidato": { "x": [1, 2, { "y": null }] },
    "numero": 429,
  },
}
`);
    const valueBefore = parse(file).a;
    await renameJson5Key(file, 'a', 'z');

    expect(parse(file).z).toEqual(valueBefore);
    expect(Object.keys(parse(file))).toEqual(['z']);
  });

  test('le chiavi vicine e il loro ORDINE non si muovono', async () => {
    const file = sandbox('{\n  "p": 1,\n  "q": 2,\n  "r": 3,\n}\n');
    await renameJson5Key(file, 'q', 'Q');

    // la rinomina è IN POSTO: `Q` resta in mezzo, non finisce in coda
    expect(Object.keys(parse(file))).toEqual(['p', 'Q', 'r']);
  });
});
