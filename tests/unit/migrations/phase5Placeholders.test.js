/**
 * Unit Tests: le tre migrazioni della Fase 5 di path-zones.
 *
 * ─── PERCHE QUESTO FILE ESISTE, E COSA COPRE DI PROPOSITO ─────────────────────
 * La revisione della Fase 4 ha trovato due difetti di perdita dati nella
 * migrazione di adminAccessControl, ed entrambi erano passati con 16 test verdi.
 * Il motivo era uno solo: i test provavano lo script contro l'input da cui era
 * stato scritto — il `.default` appena spedito — cioè il percorso felice.
 *
 * Qui si prova il contrario. Ogni migrazione viene esercitata sulle forme su cui
 * uno script del genere PUO perdere dati:
 *
 *   • un valore che l'amministratore ha MODIFICATO  → non va toccato;
 *   • un valore che l'amministratore ha AGGIUNTO    → non va toccato;
 *   • un file RIFORMATTATO                          → nessuna modifica + avviso;
 *   • una seconda esecuzione (idempotenza)          → nessuna modifica.
 *
 * Il percorso felice c'è, ma è un test fra tanti, non la copertura.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const loadJson5 = require('../../../core/loadJson5');
const setJson5Key = require('../../../core/setJson5Key');

const REPO = path.join(__dirname, '../../..');

// Un logger che REGISTRA invece di stampare: gli avvisi sono parte del contratto
// («fail-soft e lo DICHIARA»), quindi vanno asseriti, non solo non-lanciati.
function recordingLogger() {
  const lines = { info: [], warn: [], error: [] };
  return {
    log: lines,
    info: (_t, m) => lines.info.push(m),
    warn: (_t, m) => lines.warn.push(m),
    error: (_t, m) => lines.error.push(m),
  };
}

function makeSandbox(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-mig-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

function ctxFor(dir, logger, dryRun = false) {
  return { packageDir: dir, loadJson5, setJson5Key, logger, dryRun };
}

// ─────────────────────────────────────────────────────────────────────────────
// rateLimiter v1 → v2  ·  seo v1 → v2   (stessa forma: array sotto chiave nota)
// ─────────────────────────────────────────────────────────────────────────────
describe.each([
  {
    plugin: 'rateLimiter',
    script: 'plugins/rateLimiter/migrations/from-v1-to-v2.js',
    keyLine: '"exemptPaths"',
    shipped: ['/admin/**', '/public-theme-resources/**', '/admin-theme-resources/**'],
    expected: ['{{admin}}/**', '{{publicThemeResources}}/**', '{{adminThemeResources}}/**'],
    // Un RESTRINGIMENTO del percorso distribuito: vedi il test « valore MODIFICATO ».
    narrowed: '/admin/usersManagment/**',
    wrap: (arr) => `// This file follows the JSON5 standard
{
  "schemaVersion": 1,
  "custom": {
    // un commento che deve sopravvivere
    "enforcement": {
      "enabled": true,  // commento inline
      "exemptPaths": ${JSON.stringify(arr, null, 8).replace(/\n/g, '\n      ')},
    },
  },
}
`,
    read: (c) => c.custom.enforcement.exemptPaths,
  },
  {
    plugin: 'seo',
    script: 'plugins/seo/migrations/from-v1-to-v2.js',
    keyLine: '"disallow"',
    shipped: ['/admin/', '/api/', '/pluginPages/'],
    expected: ['{{admin}}/', '{{api}}/', '{{pluginPages}}/'],
    narrowed: '/admin/private/',
    wrap: (arr) => `// This file follows the JSON5 standard
{
  "schemaVersion": 1,
  "custom": {
    // un commento che deve sopravvivere
    "robotsTxtRules": {
      "userAgent": "*",  // commento inline
      "disallow": ${JSON.stringify(arr)},
    },
  },
}
`,
    read: (c) => c.custom.robotsTxtRules.disallow,
  },
])('$plugin v1 → v2', ({ plugin, script, shipped, expected, narrowed, wrap, read }) => {
  const { migrate } = require(path.join(REPO, script));

  test('converte i letterali distribuiti', async () => {
    const dir = makeSandbox({ 'pluginConfig.json5': wrap(shipped) });
    const logger = recordingLogger();
    await migrate(ctxFor(dir, logger));
    expect(read(loadJson5(path.join(dir, 'pluginConfig.json5')))).toEqual(expected);
  });

  test('conserva i commenti del file vivo, FUORI dall array', async () => {
    const dir = makeSandbox({ 'pluginConfig.json5': wrap(shipped) });
    await migrate(ctxFor(dir, recordingLogger()));
    const after = fs.readFileSync(path.join(dir, 'pluginConfig.json5'), 'utf8');
    // setJson5Key scrive la sola chiave: il resto del file resta parola per parola.
    expect(after).toContain('un commento che deve sopravvivere');
    expect(after).toContain('// commento inline');
  });

  test('conserva i commenti DENTRO l array (e prima no)', async () => {
    // ERA UN TEST CIECO. La versione precedente metteva i commenti solo FUORI
    // dall'array, quindi passava qualunque cosa accadesse dentro — e dentro
    // accadeva che sparissero tutti: fino alla v3.32.0 `setJson5Key` delegava a
    // `editJson5`, che sostituiva il BLOCCO dell'array. Un amministratore che
    // aveva annotato una propria voce la perdeva, e i `.md` di questa migrazione
    // affermavano il contrario.
    //
    // Da v3.33.0 `editJson5` ricorre per INDICE a lunghezza invariata, e qui la
    // lunghezza non cambia mai perché lo script usa `declared.map(...)`.
    const annotated = wrap(shipped).replace(
      JSON.stringify(shipped[0]),
      `// nota dell'amministratore sul primo percorso\n        ${JSON.stringify(shipped[0])}`
    );
    const dir = makeSandbox({ 'pluginConfig.json5': annotated });
    await migrate(ctxFor(dir, recordingLogger()));
    const after = fs.readFileSync(path.join(dir, 'pluginConfig.json5'), 'utf8');
    expect(after).toContain("nota dell'amministratore sul primo percorso");
    expect(read(loadJson5(path.join(dir, 'pluginConfig.json5')))).toEqual(expected);
  });

  test('NON tocca un valore che l\'amministratore ha aggiunto', async () => {
    const mine = [...shipped, '/area-riservata/**'];
    const dir = makeSandbox({ 'pluginConfig.json5': wrap(mine) });
    const logger = recordingLogger();
    await migrate(ctxFor(dir, logger));
    const after = read(loadJson5(path.join(dir, 'pluginConfig.json5')));
    expect(after).toEqual([...expected, '/area-riservata/**']);
    // E lo DICHIARA: un percorso lasciato letterale non deve essere una scoperta.
    expect(logger.log.warn.join(' ')).toContain('/area-riservata/**');
  });

  test('NON tocca un valore che l\'amministratore ha MODIFICATO', async () => {
    // È il difetto trovato in revisione sulla Fase 4: lo script dichiarava di
    // rispettare i valori personalizzati e li cancellava comunque.
    //
    // Il valore scelto NON è casuale. Una prima stesura usava `/pannello/**`,
    // che non discrimina: una conversione sbagliata PER PREFISSO lo lascerebbe
    // comunque in pace, quindi il test passava anche con lo script rotto —
    // verificato mutando lo script, e il test non se ne accorgeva. Qui si usa un
    // RESTRINGIMENTO del percorso distribuito (`/admin/usersManagment/**`), che è
    // anche la personalizzazione realistica: è l'unico input su cui uguaglianza
    // esatta e match per prefisso danno risposte diverse.
    const modified = [narrowed, ...shipped.slice(1)];
    const dir = makeSandbox({ 'pluginConfig.json5': wrap(modified) });
    const logger = recordingLogger();
    await migrate(ctxFor(dir, logger));
    const after = read(loadJson5(path.join(dir, 'pluginConfig.json5')));
    expect(after[0]).toBe(narrowed);
    expect(logger.log.warn.join(' ')).toContain(narrowed);
  });

  test('preserva l\'ORDINE, che per un first-match-wins è semantico', async () => {
    const reordered = [shipped[2], shipped[0], shipped[1]];
    const dir = makeSandbox({ 'pluginConfig.json5': wrap(reordered) });
    await migrate(ctxFor(dir, recordingLogger()));
    const after = read(loadJson5(path.join(dir, 'pluginConfig.json5')));
    expect(after).toEqual([expected[2], expected[0], expected[1]]);
  });

  test('idempotente: una seconda esecuzione non cambia niente', async () => {
    const dir = makeSandbox({ 'pluginConfig.json5': wrap(shipped) });
    await migrate(ctxFor(dir, recordingLogger()));
    const afterFirst = fs.readFileSync(path.join(dir, 'pluginConfig.json5'), 'utf8');
    const logger = recordingLogger();
    await migrate(ctxFor(dir, logger));
    expect(fs.readFileSync(path.join(dir, 'pluginConfig.json5'), 'utf8')).toBe(afterFirst);
    expect(logger.log.info.join(' ')).toMatch(/già convertit/);
  });

  test('dry-run non scrive', async () => {
    const dir = makeSandbox({ 'pluginConfig.json5': wrap(shipped) });
    const before = fs.readFileSync(path.join(dir, 'pluginConfig.json5'), 'utf8');
    await migrate(ctxFor(dir, recordingLogger(), true));
    expect(fs.readFileSync(path.join(dir, 'pluginConfig.json5'), 'utf8')).toBe(before);
  });

  test('chiave assente: non lancia, lo dice', async () => {
    const dir = makeSandbox({ 'pluginConfig.json5': '{ "schemaVersion": 1, "custom": {} }\n' });
    const logger = recordingLogger();
    await expect(migrate(ctxFor(dir, logger))).resolves.toBeUndefined();
    expect(logger.log.info.join(' ')).toMatch(/assente/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sentinel v6 → v7   (forma diversa: sostituzione testuale ancorata)
// ─────────────────────────────────────────────────────────────────────────────
describe('sentinel v6 → v7', () => {
  const { migrate } = require(path.join(REPO, 'plugins/sentinel/migrations/from-v6-to-v7.js'));

  const SHIPPED_LINE =
    '          { path: ["/api/adminUsers/login", "/api/adminUsers/logout", "/pluginPages/adminUsers/**"] },';
  const FOREIGN_LINE =
    '          { path: ["/wp-admin/**", "/phpmyadmin/**", "/.env"] },';

  const fileWith = (line) => `// This file follows the JSON5 standard
{
  schemaVersion: 1,
  rules: [
    {
      name: "auth-surface-noise",
      // un commento che deve sopravvivere
      match: {
        all: [
${line}
          { fingerprintClass: { headerProfile: "minimal" } },
        ],
      },
    },
    {
      name: "cms-probe",
      match: {
        any: [
${FOREIGN_LINE}
        ],
      },
    },
  ],
}
`;

  test('converte i path NOSTRI', async () => {
    const dir = makeSandbox({ 'sentinelRules.json5': fileWith(SHIPPED_LINE) });
    await migrate(ctxFor(dir, recordingLogger()));
    const after = loadJson5(path.join(dir, 'sentinelRules.json5'));
    expect(after.rules[0].match.all[0].path).toEqual([
      '{{api}}/adminUsers/login', '{{api}}/adminUsers/logout', '{{pluginPages}}/adminUsers/**',
    ]);
  });

  test('lascia INTATTI i pattern di tecnologie altrui', async () => {
    // Non è un dettaglio: sono la maggioranza del file, e convertirli sarebbe
    // insensato (/wp-admin non è una zona di ital8cms e non segue nulla).
    const dir = makeSandbox({ 'sentinelRules.json5': fileWith(SHIPPED_LINE) });
    await migrate(ctxFor(dir, recordingLogger()));
    const after = loadJson5(path.join(dir, 'sentinelRules.json5'));
    expect(after.rules[1].match.any[0].path).toEqual(['/wp-admin/**', '/phpmyadmin/**', '/.env']);
  });

  test('conserva i commenti', async () => {
    const dir = makeSandbox({ 'sentinelRules.json5': fileWith(SHIPPED_LINE) });
    await migrate(ctxFor(dir, recordingLogger()));
    expect(fs.readFileSync(path.join(dir, 'sentinelRules.json5'), 'utf8'))
      .toContain('un commento che deve sopravvivere');
  });

  test('file RIFORMATTATO: nessuna modifica, e lo dichiara', async () => {
    // L'ancoraggio testuale è il punto debole di questo tipo di script: deve
    // rinunciare, non indovinare. (Nella Fase 4 un ancoraggio mancato su una
    // regola scritta inline cancellava la regola SUCCESSIVA.)
    const reformatted = fileWith(
      '          { path: [ "/api/adminUsers/login", "/api/adminUsers/logout", "/pluginPages/adminUsers/**" ] },'
    );
    const dir = makeSandbox({ 'sentinelRules.json5': reformatted });
    const logger = recordingLogger();
    await migrate(ctxFor(dir, logger));
    expect(fs.readFileSync(path.join(dir, 'sentinelRules.json5'), 'utf8')).toBe(reformatted);
    expect(logger.log.warn.join(' ')).toMatch(/NESSUNA modifica/);
    expect(logger.log.warn.join(' ')).toMatch(/a mano/);
  });

  test('nessuna regola successiva viene inghiottita', async () => {
    // Il difetto esatto della Fase 4, presidiato qui prima che possa ripetersi:
    // dopo la migrazione le regole devono essere ancora DUE.
    const dir = makeSandbox({ 'sentinelRules.json5': fileWith(SHIPPED_LINE) });
    await migrate(ctxFor(dir, recordingLogger()));
    const after = loadJson5(path.join(dir, 'sentinelRules.json5'));
    expect(after.rules.map((r) => r.name)).toEqual(['auth-surface-noise', 'cms-probe']);
  });

  test('idempotente', async () => {
    const dir = makeSandbox({ 'sentinelRules.json5': fileWith(SHIPPED_LINE) });
    await migrate(ctxFor(dir, recordingLogger()));
    const afterFirst = fs.readFileSync(path.join(dir, 'sentinelRules.json5'), 'utf8');
    const logger = recordingLogger();
    await migrate(ctxFor(dir, logger));
    expect(fs.readFileSync(path.join(dir, 'sentinelRules.json5'), 'utf8')).toBe(afterFirst);
    expect(logger.log.info.join(' ')).toMatch(/già convertita/);
  });

  test('dry-run non scrive', async () => {
    const dir = makeSandbox({ 'sentinelRules.json5': fileWith(SHIPPED_LINE) });
    const before = fs.readFileSync(path.join(dir, 'sentinelRules.json5'), 'utf8');
    await migrate(ctxFor(dir, recordingLogger(), true));
    expect(fs.readFileSync(path.join(dir, 'sentinelRules.json5'), 'utf8')).toBe(before);
  });

  test('file assente: non lancia', async () => {
    const dir = makeSandbox({});
    const logger = recordingLogger();
    await expect(migrate(ctxFor(dir, logger))).resolves.toBeUndefined();
    expect(logger.log.info.join(' ')).toMatch(/non esiste/);
  });

  test('non lascia dietro il temporaneo .migrating', async () => {
    const dir = makeSandbox({ 'sentinelRules.json5': fileWith(SHIPPED_LINE) });
    await migrate(ctxFor(dir, recordingLogger()));
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.migrating'))).toEqual([]);
  });
});
