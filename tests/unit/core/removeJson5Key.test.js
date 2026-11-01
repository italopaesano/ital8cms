/**
 * Unit Tests: core/removeJson5Key.js — la quinta operazione dello strato JSON5.
 *
 * ─── COSA PRESIDIANO, E PERCHE PROPRIO QUESTI CASI ────────────────────────────
 * Questa funzione esisteva già, scritta a mano dentro uno script di migrazione
 * (`dropRuleBlock`), e ne sono usciti due difetti di perdita dati che 16 test
 * verdi non avevano colto. Il motivo era uno solo: provavano lo script contro
 * l'input da cui era stato scritto.
 *
 * Qui si parte dal contrario. I primi test sono le FORME SU CUI dropRuleBlock
 * PERDEVA DATI, e sono i più importanti del file:
 *
 *   • valore INLINE  → cercava « la prima riga di chiusura dopo la chiave »,
 *     quindi su una coppia scritta su una riga sola la cancellazione arrivava
 *     fino alla chiusura della coppia SUCCESSIVA e si portava via anche quella.
 *     Misurato sul caso reale: 8 regole diventate 3 invece di 4, con un
 *     marcatore di sicurezza sparito e il file ancora parsabile.
 *   • graffe dentro una STRINGA → `\d{1,3}` in un pattern `regex:` non deve
 *     alterare il conteggio dell'annidamento.
 *
 * Poi la policy sui commenti (D2 del registro di decisione), dove sbagliare in
 * un verso lascia commenti orfani e nell'altro cancella documentazione.
 *
 * → docs/decisions/json5-key-operations.it.md
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const json5 = require('json5');

const removeJson5Key = require('../../../core/removeJson5Key');

function sandbox(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-rmkey-'));
  const file = path.join(dir, 'config.json5');
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

const read = (file) => fs.readFileSync(file, 'utf8');
const keys = (file) => Object.keys(json5.parse(read(file)));

// ─────────────────────────────────────────────────────────────────────────────
// Le forme su cui la vecchia implementazione perdeva dati
// ─────────────────────────────────────────────────────────────────────────────
describe('le forme su cui dropRuleBlock perdeva dati', () => {
  test('valore INLINE: la coppia successiva NON sparisce', () => {
    const file = sandbox(`{
  "login": { "auth": false, "entry": true },
  "logout": {
    "auth": false,
    "entry": true
  },
  "profile": { "auth": true }
}
`);
    return removeJson5Key(file, 'login').then((out) => {
      expect(out.changed).toBe(true);
      // Il difetto storico in una riga: qui ci si aspettava 2 chiavi e ne
      // restava 1, perché la cancellazione arrivava alla chiusura di "logout".
      expect(keys(file)).toEqual(['logout', 'profile']);
      expect(json5.parse(read(file)).logout.entry).toBe(true);
    });
  });

  test('DUE coppie inline di fila: si rimuove solo la prima', () => {
    const file = sandbox(`{
  "a": { "x": 1 },
  "b": { "x": 2 },
  "c": { "x": 3 }
}
`);
    return removeJson5Key(file, 'a').then(() => {
      expect(keys(file)).toEqual(['b', 'c']);
      expect(json5.parse(read(file)).b.x).toBe(2);
    });
  });

  test('graffe dentro una STRINGA non alterano la delimitazione', () => {
    const file = sandbox(`{
  "pattern": "regex:^/ip/\\\\d{1,3}$",
  "altro": 2
}
`);
    return removeJson5Key(file, 'pattern').then(() => {
      expect(keys(file)).toEqual(['altro']);
    });
  });

  test('una stringa che CONTIENE una graffa di chiusura', () => {
    const file = sandbox(`{
  "a": "}",
  "b": 2
}
`);
    return removeJson5Key(file, 'a').then(() => {
      expect(keys(file)).toEqual(['b']);
    });
  });

  test('una virgola dentro una stringa non viene mangiata come strutturale', () => {
    const file = sandbox(`{
  "a": "x,y",
  "b": 2
}
`);
    return removeJson5Key(file, 'a').then(() => {
      expect(json5.parse(read(file))).toEqual({ b: 2 });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Forme del valore
// ─────────────────────────────────────────────────────────────────────────────
describe('forme del valore', () => {
  test.each([
    ['scalare', '{\n  "a": 1,\n  "b": 2\n}\n', 'a', ['b']],
    ['stringa', '{\n  "a": "x",\n  "b": 2\n}\n', 'a', ['b']],
    ['null', '{\n  "a": null,\n  "b": 2\n}\n', 'a', ['b']],
    ['array inline', '{\n  "a": [1, 2, 3],\n  "b": 2\n}\n', 'a', ['b']],
    ['array multiriga', '{\n  "a": [\n    1,\n    2,\n  ],\n  "b": 2\n}\n', 'a', ['b']],
    ['oggetto multiriga', '{\n  "a": {\n    "x": 1,\n  },\n  "b": 2\n}\n', 'a', ['b']],
    ['oggetto annidato', '{\n  "a": { "x": { "y": [1] } },\n  "b": 2\n}\n', 'a', ['b']],
  ])('%s', (_nome, content, key, expected) => {
    const file = sandbox(content);
    return removeJson5Key(file, key).then(() => expect(keys(file)).toEqual(expected));
  });

  test('ultima chiave, senza virgola finale: il file resta valido', () => {
    const file = sandbox('{\n  "a": 1,\n  "b": 2\n}\n');
    return removeJson5Key(file, 'b').then(() => {
      // JSON5 ammette la virgola finale, quindi `"a": 1,` davanti a `}` va bene.
      expect(() => json5.parse(read(file))).not.toThrow();
      expect(json5.parse(read(file))).toEqual({ a: 1 });
    });
  });

  test('UNICA chiave dell oggetto: resta un oggetto vuoto', () => {
    const file = sandbox('{\n  "a": 1\n}\n');
    return removeJson5Key(file, 'a').then(() => {
      expect(json5.parse(read(file))).toEqual({});
    });
  });

  test('chiave annidata, via path ad array', () => {
    const file = sandbox(`{
  "custom": {
    "enforcement": {
      "enabled": true,
      "exemptPaths": ["/admin/**"],
    },
  },
}
`);
    return removeJson5Key(file, ['custom', 'enforcement', 'exemptPaths']).then((out) => {
      expect(out.changed).toBe(true);
      expect(out.removedValue).toEqual(['/admin/**']);
      expect(json5.parse(read(file))).toEqual({ custom: { enforcement: { enabled: true } } });
    });
  });

  test('chiave non quotata (JSON5) e apici singoli', () => {
    const file = sandbox("{\n  a: 1,\n  b: 'x',\n}\n");
    return removeJson5Key(file, 'a').then(() => {
      expect(json5.parse(read(file))).toEqual({ b: 'x' });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D2 — di chi sono i commenti
// ─────────────────────────────────────────────────────────────────────────────
describe('D2 — proprietà dei commenti', () => {
  test('caso A: il commento in linea di una chiave PRECEDENTE resta', () => {
    const file = sandbox('{\n  "a": 1,   // nota di A\n  "b": 2,\n  "c": 3\n}\n');
    return removeJson5Key(file, 'b').then(() => {
      // La riga di "a" contiene CODICE, quindi la risalita si ferma lì.
      expect(read(file)).toContain('// nota di A');
      expect(keys(file)).toEqual(['a', 'c']);
    });
  });

  test('caso B: il commento in linea della chiave che se ne va parte con lei', () => {
    const file = sandbox('{\n  "a": 1,\n  "b": 2,   // nota di B\n  "c": 3\n}\n');
    return removeJson5Key(file, 'b').then(() => {
      expect(read(file)).not.toContain('nota di B');
      expect(keys(file)).toEqual(['a', 'c']);
    });
  });

  test('caso C: il blocco di commenti direttamente sopra parte tutto', () => {
    const file = sandbox('{\n  "a": 1,\n  // prima riga\n  // seconda riga\n  "b": 2,\n  "c": 3\n}\n');
    return removeJson5Key(file, 'b').then(() => {
      expect(read(file)).not.toContain('prima riga');
      expect(read(file)).not.toContain('seconda riga');
    });
  });

  test('la riga VUOTA ferma la risalita: la documentazione di SEZIONE resta', () => {
    // È il caso reale di accessControl.json5: senza questa fermata, rimuovendo
    // una regola se ne andrebbero 10 righe invece di 1, fra cui la spiegazione
    // valida per tutte le regole vicine.
    const file = sandbox(`{
  // ─── documentazione di SEZIONE ───
  // vale per tutte le chiavi vicine

  // nota della sola b
  "b": 2,
  "c": 3
}
`);
    return removeJson5Key(file, 'b').then(() => {
      expect(read(file)).toContain('documentazione di SEZIONE');
      expect(read(file)).toContain('vale per tutte le chiavi vicine');
      expect(read(file)).not.toContain('nota della sola b');
    });
  });

  test('un blocco /* */ su PIU righe non viene toccato (resta orfano)', () => {
    // Direzione di fallimento scelta: portarne via una parte produrrebbe un file
    // non più parsabile. Orfano e inerte è meglio di rotto.
    const file = sandbox('{\n  /* blocco\n     su due righe */\n  "b": 2,\n  "c": 3\n}\n');
    return removeJson5Key(file, 'b').then(() => {
      expect(read(file)).toContain('su due righe');
      expect(() => json5.parse(read(file))).not.toThrow();
      expect(keys(file)).toEqual(['c']);
    });
  });

  test('un blocco /* */ COMPLETO su una riga parte con la chiave', () => {
    const file = sandbox('{\n  /* nota di b */\n  "b": 2,\n  "c": 3\n}\n');
    return removeJson5Key(file, 'b').then(() => {
      expect(read(file)).not.toContain('nota di b');
    });
  });

  test('due coppie sulla STESSA riga: non si risale, e la vicina resta', () => {
    const file = sandbox('{\n  // nota che NON appartiene a b\n  "a": 1, "b": 2,\n  "c": 3\n}\n');
    return removeJson5Key(file, 'b').then(() => {
      expect(read(file)).toContain('nota che NON appartiene a b');
      expect(keys(file)).toEqual(['a', 'c']);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Contratto
// ─────────────────────────────────────────────────────────────────────────────
describe('contratto', () => {
  test('chiave assente: NO-OP, non un errore', () => {
    // Le migrazioni devono essere idempotenti: alla seconda esecuzione la chiave
    // non c'è più, e quello è il risultato atteso.
    const file = sandbox('{\n  "a": 1\n}\n');
    const before = read(file);
    return removeJson5Key(file, 'inesistente').then((out) => {
      expect(out).toEqual({ changed: false, removedValue: undefined });
      expect(read(file)).toBe(before);
    });
  });

  test('segmento intermedio assente: NO-OP', () => {
    const file = sandbox('{\n  "a": 1\n}\n');
    return removeJson5Key(file, ['custom', 'x']).then((out) => {
      expect(out.changed).toBe(false);
    });
  });

  test('IDEMPOTENTE: la seconda esecuzione non cambia niente', async () => {
    const file = sandbox('{\n  "a": 1,\n  "b": 2\n}\n');
    await removeJson5Key(file, 'a');
    const afterFirst = read(file);
    const out = await removeJson5Key(file, 'a');
    expect(out.changed).toBe(false);
    expect(read(file)).toBe(afterFirst);
  });

  test('un nome del PROTOTIPO non conta come chiave esistente', async () => {
    // Stessa classe di REVIEW.md → B4: senza hasOwnProperty, `constructor`
    // pescherebbe dal prototipo un valore truthy e la funzione crederebbe che la
    // chiave esista, provando a localizzarla in un testo che non la contiene.
    const file = sandbox('{\n  "a": 1\n}\n');
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const out = await removeJson5Key(file, name);
      expect(out.changed).toBe(false);
    }
    expect(json5.parse(read(file))).toEqual({ a: 1 });
  });

  test('path AMBIGUO: rifiuta invece di scegliere', async () => {
    // JSON5 ammette chiavi duplicate (vince l'ultima). Cancellare quella
    // sbagliata è peggio che non cancellare.
    const file = sandbox('{\n  "a": 1,\n  "a": 2\n}\n');
    const before = read(file);
    await expect(removeJson5Key(file, 'a')).rejects.toThrow();
    expect(read(file)).toBe(before);
  });

  test('ritorna il valore rimosso', () => {
    const file = sandbox('{\n  "a": { "x": [1, 2] },\n  "b": 2\n}\n');
    return removeJson5Key(file, 'a').then((out) => {
      expect(out.removedValue).toEqual({ x: [1, 2] });
    });
  });

  test('JSON5 non valido: lancia e non scrive', async () => {
    const file = sandbox('{ "a": 1,, }\n');
    const before = read(file);
    await expect(removeJson5Key(file, 'a')).rejects.toThrow(/not valid JSON5/);
    expect(read(file)).toBe(before);
  });

  test('radice non oggetto: lancia', async () => {
    const file = sandbox('[1, 2, 3]\n');
    await expect(removeJson5Key(file, 'a')).rejects.toThrow(/not a JSON5 object/);
  });

  test.each([
    ['filePath vuoto', '', 'a', /filePath/],
    ['chiave vuota', null, '', /non-empty string/],
    ['array vuoto', null, [], /at least one segment/],
    ['segmento non stringa', null, ['a', 2], /every path segment/],
    ['secondo argomento numerico', null, 42, /must be a string/],
  ])('rifiuta argomenti sbagliati: %s', async (_nome, overrideFile, key, pattern) => {
    const file = overrideFile === null ? sandbox('{\n  "a": 1\n}\n') : overrideFile;
    await expect(removeJson5Key(file, key)).rejects.toThrow(pattern);
  });

  test('non lascia dietro file temporanei', async () => {
    const file = sandbox('{\n  "a": 1,\n  "b": 2\n}\n');
    await removeJson5Key(file, 'a');
    const dir = path.dirname(file);
    expect(fs.readdirSync(dir)).toEqual(['config.json5']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Postcondizione
// ─────────────────────────────────────────────────────────────────────────────
describe('postcondizione: sparisce SOLO la chiave chiesta', () => {
  test('tutto il resto del documento resta identico, valori compresi', () => {
    const file = sandbox(`{
  "schemaVersion": 3,
  "custom": {
    "a": [1, 2, 3],
    "b": { "nested": true },
  },
  "daRimuovere": 1,
  "ultimo": "x",
}
`);
    return removeJson5Key(file, 'daRimuovere').then(() => {
      expect(json5.parse(read(file))).toEqual({
        schemaVersion: 3,
        custom: { a: [1, 2, 3], b: { nested: true } },
        ultimo: 'x',
      });
    });
  });

  test('l ordine delle chiavi superstiti è preservato', () => {
    const file = sandbox('{\n  "z": 1,\n  "m": 2,\n  "a": 3\n}\n');
    return removeJson5Key(file, 'm').then(() => {
      expect(keys(file)).toEqual(['z', 'a']);
    });
  });

  test('la formattazione del resto del file non è normalizzata', () => {
    const file = sandbox('{\n  "a":    1,\n  "b": 2,\n\t"c":\t3\n}\n');
    return removeJson5Key(file, 'b').then(() => {
      // Chirurgia, non riscrittura: spaziatura e tab di a e c restano come erano.
      expect(read(file)).toContain('"a":    1,');
      expect(read(file)).toContain('\t"c":\t3');
    });
  });
});
