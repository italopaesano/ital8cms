/**
 * decoyRenderer.test.js
 *
 * Il renderer dei contenuti fittizi. Tre famiglie di verifiche, in ordine di
 * gravità di ciò che proteggono:
 *
 *   1. RISOLUZIONE — precedenza di `decoys/data/` su `decoys/default/`, e il
 *      rifiuto di qualunque nome che esca dalla cartella. Un decoy è un file
 *      scelto da un file di configurazione: se il nome potesse contenere un
 *      percorso, `sentinelRules.json5` diventerebbe una primitiva di lettura
 *      arbitraria del filesystem, servita a chi ha fatto la richiesta.
 *   2. SEGNAPOSTO — l'escaping di quelli riflessi. `{{path}}` e `{{ip}}` sono
 *      stringhe scelte dall'attaccante: in un decoy HTML, senza escape, sono una
 *      XSS riflessa a danno non di lui ma di chi riceve da lui il link.
 *   3. TIPO E CACHE — l'estensione decide il Content-Type, e la cache non deve
 *      confondere due file diversi.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  renderDecoy,
  resolveDecoyPath,
  renderTemplate,
  DECOY_DIR,
  USER_SUBDIR,
  SHIPPED_SUBDIR,
} = require('../../lib/decoyRenderer');

let sandbox;

function writeDecoy(subdir, fileName, content) {
  const dir = path.join(sandbox, DECOY_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), content, 'utf8');
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-decoy-'));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('resolveDecoyPath — le due cartelle', () => {
  test('trova il file fornito col plugin', () => {
    writeDecoy(SHIPPED_SUBDIR, 'trap.html', 'shipped');
    expect(resolveDecoyPath(sandbox, 'trap.html'))
      .toBe(path.join(sandbox, DECOY_DIR, SHIPPED_SUBDIR, 'trap.html'));
  });

  test('la versione dell\'utente ha la precedenza su quella fornita', () => {
    writeDecoy(SHIPPED_SUBDIR, 'trap.html', 'shipped');
    writeDecoy(USER_SUBDIR, 'trap.html', 'personalizzato');
    expect(resolveDecoyPath(sandbox, 'trap.html'))
      .toBe(path.join(sandbox, DECOY_DIR, USER_SUBDIR, 'trap.html'));
  });

  test('null se il file non esiste in nessuna delle due', () => {
    expect(resolveDecoyPath(sandbox, 'assente.html')).toBeNull();
  });

  test.each([
    ['../../../etc/passwd'],
    ['../pluginConfig.json5'],
    ['sub/trap.html'],
    ['..'],
  ])('rifiuta il nome con percorso %s', (name) => {
    expect(resolveDecoyPath(sandbox, name)).toBeNull();
  });

  test('un nome con percorso non legge il file anche se esiste davvero', () => {
    // Il bersaglio esiste ed è raggiungibile risalendo di un livello: se la
    // guardia mancasse, il test lo troverebbe.
    fs.writeFileSync(path.join(sandbox, 'segreto.txt'), 'contenuto riservato', 'utf8');
    fs.mkdirSync(path.join(sandbox, DECOY_DIR, SHIPPED_SUBDIR), { recursive: true });
    expect(resolveDecoyPath(sandbox, '../../segreto.txt')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('renderTemplate — segnaposto', () => {
  test('{{today}} è una data ISO e {{timestamp}} un intero', () => {
    const out = renderTemplate('{{today}}|{{timestamp}}', {}, false);
    const [today, ts] = out.split('|');
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isInteger(Number(ts))).toBe(true);
  });

  test('{{random:N}} produce esattamente N caratteri', () => {
    expect(renderTemplate('{{random:32}}', {}, false)).toHaveLength(32);
    expect(renderTemplate('{{random:1}}', {}, false)).toHaveLength(1);
  });

  test('due rese dello stesso template non coincidono', () => {
    // È la ragione d'essere del livello 1: un decoy identico a se stesso viene
    // riconosciuto da un hash del contenuto, e smette di ingannare.
    const template = 'key={{random:40}}';
    expect(renderTemplate(template, {}, false)).not.toBe(renderTemplate(template, {}, false));
  });

  test('{{choice:a|b|c}} sceglie fra le alternative dichiarate', () => {
    const seen = new Set();
    for (let i = 0; i < 60; i++) seen.add(renderTemplate('{{choice:7.4.33|8.1.2}}', {}, false));
    for (const value of seen) expect(['7.4.33', '8.1.2']).toContain(value);
    expect(seen.size).toBe(2); // 60 estrazioni su 2 valori: la probabilità di mancarne uno è ~1e-18
  });

  test('un segnaposto sconosciuto resta com\'è', () => {
    expect(renderTemplate('{{inesistente}}', {}, false)).toBe('{{inesistente}}');
  });

  test('{{path}} e {{ip}} sono escapati nel contesto HTML', () => {
    const out = renderTemplate('{{path}}', { path: '/<script>alert(1)</script>' }, true);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  test('{{path}} NON è escapato fuori dal contesto HTML', () => {
    // In un finto .env o in un log finto l'escaping HTML sarebbe rumore visibile
    // che tradisce la trappola, e non c'è nessun parser di markup a valle.
    expect(renderTemplate('{{path}}', { path: '/a&b' }, false)).toBe('/a&b');
  });

  test('un valore riflesso assente diventa stringa vuota, non "undefined"', () => {
    expect(renderTemplate('[{{ip}}]', {}, true)).toBe('[]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('renderDecoy — resa completa', () => {
  test('rende il file e ne deduce il tipo dall\'estensione', () => {
    writeDecoy(SHIPPED_SUBDIR, 'fake.html', '<p>{{path}}</p>');
    const out = renderDecoy({ pluginFolder: sandbox, spec: { file: 'fake.html' }, vars: { path: '/wp-login.php' } });

    expect(out.ok).toBe(true);
    expect(out.body).toBe('<p>/wp-login.php</p>');
    expect(out.type).toBe('text/html; charset=utf-8');
    expect(out.status).toBe(200);
  });

  test.each([
    ['fake.txt', 'text/plain; charset=utf-8'],
    ['fake.json', 'application/json; charset=utf-8'],
    ['fake.xml', 'application/xml; charset=utf-8'],
    ['fake.unknown', 'text/plain; charset=utf-8'],
  ])('%s → %s', (fileName, expectedType) => {
    writeDecoy(SHIPPED_SUBDIR, fileName, 'x');
    expect(renderDecoy({ pluginFolder: sandbox, spec: { file: fileName }, vars: {} }).type)
      .toBe(expectedType);
  });

  test('lo stato e gli header dichiarati dalla regola arrivano intatti', () => {
    writeDecoy(SHIPPED_SUBDIR, 'fake.html', 'x');
    const out = renderDecoy({
      pluginFolder: sandbox,
      spec: { file: 'fake.html', status: 401, headers: { 'X-Powered-By': 'PHP/7.4.33' } },
      vars: {},
    });
    expect(out.status).toBe(401);
    expect(out.headers).toEqual({ 'X-Powered-By': 'PHP/7.4.33' });
  });

  test('null se il file non esiste — il chiamante degrada al 404', () => {
    expect(renderDecoy({ pluginFolder: sandbox, spec: { file: 'assente.html' }, vars: {} })).toBeNull();
  });

  test('null su nome con percorso, anche se il file esiste', () => {
    fs.writeFileSync(path.join(sandbox, 'segreto.txt'), 'riservato', 'utf8');
    expect(renderDecoy({ pluginFolder: sandbox, spec: { file: '../../segreto.txt' }, vars: {} })).toBeNull();
  });

  test('la cache evita la rilettura ma non congela il risultato', () => {
    writeDecoy(SHIPPED_SUBDIR, 'fake.txt', 'id={{random:8}}');
    const cache = new Map();
    const opts = { pluginFolder: sandbox, spec: { file: 'fake.txt' }, vars: {}, useCache: true, cache };

    const first = renderDecoy(opts);
    expect(cache.size).toBe(1);

    // Il file cambia sotto i piedi: con la cache attiva NON deve essere riletto…
    writeDecoy(SHIPPED_SUBDIR, 'fake.txt', 'contenuto nuovo');
    const second = renderDecoy(opts);
    expect(second.body).toMatch(/^id=/);

    // …ma i segnaposto si rendono a ogni richiesta, non una volta sola.
    expect(second.body).not.toBe(first.body);
  });

  test('senza cache il file modificato viene riletto', () => {
    writeDecoy(SHIPPED_SUBDIR, 'fake.txt', 'vecchio');
    const spec = { file: 'fake.txt' };
    expect(renderDecoy({ pluginFolder: sandbox, spec, vars: {} }).body).toBe('vecchio');
    writeDecoy(SHIPPED_SUBDIR, 'fake.txt', 'nuovo');
    expect(renderDecoy({ pluginFolder: sandbox, spec, vars: {} }).body).toBe('nuovo');
  });

  test('la cache è per file, non per regola: due decoy non si confondono', () => {
    writeDecoy(SHIPPED_SUBDIR, 'uno.txt', 'primo');
    writeDecoy(SHIPPED_SUBDIR, 'due.txt', 'secondo');
    const cache = new Map();
    const common = { pluginFolder: sandbox, vars: {}, useCache: true, cache };

    expect(renderDecoy({ ...common, spec: { file: 'uno.txt' } }).body).toBe('primo');
    expect(renderDecoy({ ...common, spec: { file: 'due.txt' } }).body).toBe('secondo');
    expect(cache.size).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('i decoy distribuiti col plugin', () => {
  const shippedDir = path.join(__dirname, '..', '..', DECOY_DIR, SHIPPED_SUBDIR);
  const pluginRoot = path.join(__dirname, '..', '..');
  // README.md documenta la cartella, non è un decoy: sta lì proprio perché la
  // spiegazione non può stare dentro i file serviti.
  const shipped = fs.readdirSync(shippedDir)
    .filter((f) => !f.startsWith('.') && f !== 'README.md');

  test('ce n\'è almeno uno', () => {
    expect(shipped.length).toBeGreaterThan(0);
  });

  test.each(shipped)('%s si rende senza lasciare segnaposto noti', (fileName) => {
    const out = renderDecoy({
      pluginFolder: pluginRoot,
      spec: { file: fileName },
      vars: { path: '/wp-login.php', ip: '203.0.113.7' },
    });
    expect(out).not.toBeNull();
    expect(out.body).not.toMatch(/\{\{(now|today|timestamp|random|choice|path|ip)\b/);
  });

  test.each(shipped)('%s non si annuncia come falso', (fileName) => {
    // IL test di questa famiglia. Un commento che spiega «questo è un decoy»
    // viene servito insieme al resto del file: chi lo legge non solo non è stato
    // ingannato, ha appena scoperto che c'è un filtro — cioè l'esatto contrario
    // dello scopo. Le spiegazioni stanno in decoys/default/README.md.
    const body = fs.readFileSync(path.join(shippedDir, fileName), 'utf8');
    for (const giveaway of ['decoy', 'DECOY', 'sentinel', 'finto', 'fittizio', 'trappola', 'honeypot']) {
      expect(body).not.toContain(giveaway);
    }
  });

  test.each(shipped)('%s non contiene percorsi reali di questa installazione', (fileName) => {
    // Un decoy che si lascia sfuggire un percorso vero regala esattamente
    // l'informazione che dovrebbe negare.
    const body = fs.readFileSync(path.join(shippedDir, fileName), 'utf8');
    expect(body).not.toContain('ital8cms');
    expect(body).not.toContain(process.cwd());
  });
});
