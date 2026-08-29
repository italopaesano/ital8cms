// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * I formattatori client-side della dashboard adminRateLimiter.
 *
 * ─── PERCHÉ QUESTO FILE ESISTE ────────────────────────────────────────────────
 * È il primo frutto della decisione sulla **terza via** per la GUI admin: non
 * `jsdom`, non e2e, ma il guard `typeof module` che rende testabili le funzioni
 * PURE di un file client-side senza allestire un DOM — cosa che questo progetto
 * non fa da nessuna parte. Il pattern è nato in
 * `adminSentinel/adminWebSections/sentinelManagement/rule-form.js`, dove serviva
 * a coprire due mappature che avevano perso dati; qui viene esteso come
 * convenzione.
 *
 * ─── PERCHÉ PROPRIO QUESTE QUATTRO ────────────────────────────────────────────
 * Non tutto il client-side merita il pattern: applicarlo a un file di soli
 * gestori di eventi non guadagna niente. Queste quattro sì, per due ragioni
 * diverse:
 *
 *   • `formatDuration` è un formattatore « ovvio » pieno di casi limite, e il
 *     numero che stampa è ciò che un amministratore legge per decidere se un
 *     blocco è ancora attivo. Sbagliarlo non produce un errore: produce una
 *     decisione sbagliata.
 *   • `tierBadge` ed `eventBadge` costruiscono HTML a partire da stringhe che
 *     arrivano dal server. Il loro escaping è una **superficie XSS**, ed è la
 *     cosa che un test può verificare meglio di una rilettura.
 */

const path = require('path');

const CLIENT = path.join(
  __dirname, '../../adminWebSections/rateLimiterManagement/rateLimiter-admin.js'
);

// Il require funziona solo grazie al doppio guard nel file: `module.exports` per
// esportare, e `if (typeof document === 'undefined') return;` per non tentare di
// agganciare listener che sotto Node non esistono.
const { esc, formatDuration, formatTime, tierBadge, eventBadge } = require(CLIENT);

describe('il file client-side è caricabile sotto Node', () => {
  test('espone le funzioni pure e nient\'altro', () => {
    // Se esportasse anche la logica che tocca il DOM, il require esploderebbe
    // alla prima chiamata invece che al load: meglio che la superficie sia
    // esattamente ciò che è puro.
    expect(Object.keys(require(CLIENT)).sort())
      .toEqual(['esc', 'eventBadge', 'formatDuration', 'formatTime', 'tierBadge']);
  });

  test('il guard sul DOM esiste, ed è ciò che rende possibile il require', () => {
    // La premessa del file. Senza, `document.addEventListener` al fondo
    // lancerebbe sotto Node e nessuno di questi test potrebbe esistere.
    const sorgente = require('fs').readFileSync(CLIENT, 'utf8');
    expect(sorgente).toMatch(/if \(typeof document === 'undefined'\) return;/);
    expect(sorgente).toMatch(/typeof module !== 'undefined' && module\.exports/);
  });
});

describe('formatDuration() — il tempo che l\'admin legge per decidere', () => {
  test.each([
    ['secondi soli',            45,     '45s'],
    ['minuti e secondi',        125,    '2m 5s'],
    ['ore e minuti',            3661,   '1h 1m'],
    ['esattamente un minuto',   60,     '1m 0s'],
    ['esattamente un\'ora',     3600,   '1h 0m'],
    ['zero',                    0,      '0s'],
  ])('%s: %i → %s', (_caso, secondi, atteso) => {
    expect(formatDuration(secondi)).toBe(atteso);
  });

  test('sopra l\'ora i secondi NON vengono mostrati, e va bene così', () => {
    // 1h 0m 59s e 1h 0m 1s sono la stessa informazione per chi decide se
    // aspettare: il troncamento è voluto, non una perdita.
    expect(formatDuration(3659)).toBe('1h 0m');
    expect(formatDuration(3601)).toBe('1h 0m');
  });

  test.each([
    ['negativo',      -10],
    ['NaN',           NaN],
    ['null',          null],
    ['undefined',     undefined],
    ['stringa vuota', ''],
    ['non numerico',  'abc'],
  ])('input %s → "0s", non "NaNs" né un numero negativo', (_caso, valore) => {
    // `Math.max(0, Math.floor(Number(sec) || 0))` è la riga che regge tutti
    // questi casi. Senza, la tabella dei blocchi attivi mostrerebbe "NaNs" o
    // una durata negativa — e un `retryAfterSeconds` mancante dal server è
    // esattamente il tipo di cosa che capita.
    expect(formatDuration(valore)).toBe('0s');
  });

  test('un decimale viene troncato, non arrotondato', () => {
    expect(formatDuration(59.9)).toBe('59s');
  });

  test('una stringa numerica funziona: il server può mandare "120"', () => {
    expect(formatDuration('120')).toBe('2m 0s');
  });
});

describe('formatTime() — non deve mai mostrare "Invalid Date"', () => {
  test('una data valida non torna com\'era', () => {
    const reso = formatTime('2026-08-29T10:00:00.000Z');
    expect(reso).not.toBe('2026-08-29T10:00:00.000Z');
    expect(reso.length).toBeGreaterThan(0);
  });

  test.each([
    ['una stringa non parsabile', 'non-una-data'],
    ['stringa vuota',             ''],
  ])('%s → restituisce l\'input, non "Invalid Date"', (_caso, valore) => {
    // La scelta del file: se non sa formattare, mostra il valore grezzo. È più
    // utile di "Invalid Date", perché almeno dice cosa è arrivato dal server.
    expect(formatTime(valore)).toBe(String(valore));
    expect(formatTime(valore)).not.toMatch(/Invalid Date/);
  });

  test('un epoch numerico è accettato', () => {
    expect(formatTime(1756461600000)).not.toMatch(/Invalid Date/);
  });
});

describe('i badge — HTML costruito da stringhe che arrivano dal server', () => {
  test('tierBadge distingue i tre livelli con classi diverse', () => {
    // Il colore è l'informazione: rosso = blocco lungo, giallo = corto. Se le
    // classi coincidessero, la tabella smetterebbe di distinguerli a colpo
    // d'occhio senza che nulla fallisca.
    const lungo = tierBadge('long');
    const corto = tierBadge('short');
    const altro = tierBadge('qualcosa');

    expect(lungo).toContain('bg-danger');
    expect(corto).toContain('bg-warning');
    expect(altro).toContain('bg-secondary');
    expect(new Set([lungo, corto, altro]).size).toBe(3);
  });

  test('eventBadge copre i sette eventi noti e ha un fallback', () => {
    for (const evento of ['failure', 'shortBlock', 'longBlock', 'manualBlock',
      'success', 'release', 'releaseAll']) {
      expect(eventBadge(evento)).toContain(evento);
      expect(eventBadge(evento)).not.toContain('bg-light');
    }
    // Un evento che il server aggiungesse domani non deve sparire dalla tabella.
    expect(eventBadge('eventoNuovo')).toContain('bg-light');
    expect(eventBadge('eventoNuovo')).toContain('eventoNuovo');
  });

  test.each([
    ['tierBadge',  tierBadge],
    ['eventBadge', eventBadge],
  ])('%s ESCAPA il valore: è una superficie XSS', (_nome, fn) => {
    // `tier` ed `event` arrivano dal server dentro `innerHTML`. Se un giorno un
    // valore controllabile da chi attacca ci finisse dentro, l'escaping è
    // l'unica cosa che sta in mezzo.
    //
    // LA PROPRIETÀ GIUSTA è che il payload non produca TAG, non che sparisca:
    // `onerror=alert(1)` resta nell'output come testo — innocuo, perché `<` è
    // stato escapato e il browser non apre nessun elemento. Un test che
    // pretendesse la sparizione della stringa verificherebbe qualcosa che non è
    // la sicurezza (e questo test lo pretendeva, al primo tentativo).
    const reso = fn('<img src=x onerror=alert(1)>');

    // Il payload è presente ma neutralizzato.
    expect(reso).toContain('&lt;img');
    // E fuori dal `<span>` che il badge crea di suo non resta nessun tag: tolto
    // l'involucro noto, non deve esserci più alcun `<` o `>`.
    const contenuto = reso.replace(/^<span class="[^"]*">/, '').replace(/<\/span>$/, '');
    expect(contenuto).not.toMatch(/[<>]/);
  });

  test.each([
    ['tierBadge',  tierBadge],
    ['eventBadge', eventBadge],
  ])('%s mostra un trattino invece di "undefined"', (_nome, fn) => {
    expect(fn(undefined)).toContain('—');
    expect(fn(null)).toContain('—');
    expect(fn('')).toContain('—');
    expect(fn(undefined)).not.toContain('undefined');
  });
});

describe('esc() — il fallback difensivo quando il tema non fornisce escapeHtml', () => {
  test('sotto Node è il fallback locale, e funziona', () => {
    // In browser `esc` è l'`escapeHtml` globale del tema admin; qui non c'è, e
    // il file ricade sulla propria implementazione. Testarla significa testare
    // proprio il ramo che nessuno guarda mai — quello che agisce quando il tema
    // non ha caricato lo script.
    expect(esc('<script>')).toBe('&lt;script&gt;');
    expect(esc('a & b')).toBe('a &amp; b');
    expect(esc('"virgolette"')).toBe('&quot;virgolette&quot;');
    expect(esc("l'apostrofo")).toBe('l&#39;apostrofo');
  });

  test('null e undefined diventano stringa vuota, non "null"', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
});
