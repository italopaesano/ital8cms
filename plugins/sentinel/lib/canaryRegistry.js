/**
 * canaryRegistry.js
 *
 * Conia i token esca inseriti nei decoy e riconosce chi li usa.
 *
 * ─── PERCHE UN CANARY VALE PIU DI QUALSIASI REGOLA ────────────────────────────
 * Tutto il resto del plugin ragiona per **indizi**: questo User-Agent mente,
 * questo client ha collezionato quaranta 404, questo percorso somiglia a una
 * sonda WordPress. Sono inferenze, e le inferenze hanno falsi positivi — è il
 * motivo per cui sentinel nasce in osservazione e la promozione è un atto
 * deliberato.
 *
 * Un canary no. Il token esiste in **un solo posto al mondo**: dentro il corpo
 * di un decoy servito a un cliente specifico, in un momento specifico. Nessun
 * motore di ricerca lo indicizza, nessun link ci porta, nessun utente lo digita
 * per sbaglio. Se qualcuno lo richiede, ha **letto** il decoy e ha deciso di
 * seguirlo: non è un'inferenza, è una certezza. È l'unico segnale del plugin per
 * cui un ban immediato è difendibile.
 *
 * ─── COSA SI CONSERVA, E PERCHE ───────────────────────────────────────────────
 * Al momento della consegna si registra a CHI è stato dato il token (indirizzo,
 * impronta, percorso, istante). Quando torna indietro, il confronto fra chi l'ha
 * ricevuto e chi lo sta usando dice qualcosa che nessun altro dato del plugin
 * può dire:
 *
 *   stesso client        → uno scanner automatico che segue i link che trova
 *   client DIVERSO       → il contenuto è stato passato a qualcun altro, o la
 *                          scansione e lo sfruttamento sono due macchine diverse
 *                          (tipico delle operazioni un po' più strutturate)
 *
 * ─── PERCHE IL REGISTRO HA UN TETTO ───────────────────────────────────────────
 * Ogni risposta con un decoy conia un token, e la frequenza delle risposte la
 * decide chi bussa. Senza tetto, martellare un percorso con decoy sarebbe il modo
 * più semplice di esaurire la memoria del processo: la trappola diventerebbe il
 * vettore. Vale qui la stessa logica del censimento delle impronte, e infatti si
 * riusa lo stesso `BoundedStore` con sfratto LRU.
 *
 * ─── E QUANDO IL TOKEN NON LO RICONOSCIAMO? ───────────────────────────────────
 * Un token può risultare sconosciuto per tre ragioni: il processo è stato
 * riavviato (il registro vive in memoria), è stato sfrattato per anzianità, o è
 * stato coniato da un altro worker in cluster. In tutti e tre i casi il token
 * *resta un token*: nessun visitatore reale invia per caso una stringa di quella
 * forma. Per questo la verifica distingue `known` da `unknown` invece di
 * rispondere sì/no — sono due gradi di certezza diversi, e la regola sceglie
 * quale le basta.
 */

'use strict';

const crypto = require('crypto');
const BoundedStore = require('./boundedStore');

/**
 * Alfabeto e lunghezza della parte casuale.
 *
 * 22 caratteri base36 sono ~113 bit: indovinarne uno è impossibile, che è il
 * punto — un token indovinabile trasformerebbe la certezza in un falso positivo.
 */
const TOKEN_BODY_LENGTH = 22;
const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Prefisso di default.
 *
 * Serve a riconoscere la FORMA di un token anche quando non è nel registro, ed è
 * quindi un compromesso dichiarato: rende i token individuabili in un corpo di
 * risposta anche da chi sappia cosa cercare. Resta il compromesso giusto —
 * l'alternativa (nessun prefisso) renderebbe indistinguibile un token scaduto da
 * una qualunque stringa alfanumerica, e dopo ogni riavvio la trappola varrebbe
 * zero. È configurabile proprio perché un valore diverso dal default rende
 * inutile un eventuale riconoscimento a colpo d'occhio.
 */
const DEFAULT_PREFIX = 'a7';

/** Un prefisso troppo corto o troppo lungo rende il riconoscimento inaffidabile. */
const MIN_PREFIX_LENGTH = 1;
const MAX_PREFIX_LENGTH = 8;

class CanaryRegistry {
  /**
   * @param {object} [options]
   * @param {string} [options.tokenPrefix]
   * @param {number} [options.maxTokens]
   * @param {number} [options.ttlHours]
   */
  constructor(options = {}) {
    const rawPrefix = typeof options.tokenPrefix === 'string' ? options.tokenPrefix.trim() : '';
    const usablePrefix = /^[a-z0-9]+$/.test(rawPrefix)
      && rawPrefix.length >= MIN_PREFIX_LENGTH
      && rawPrefix.length <= MAX_PREFIX_LENGTH
      ? rawPrefix
      : DEFAULT_PREFIX;

    this.prefix = usablePrefix;

    // Il riconoscimento gira su ogni richiesta: la regex si costruisce una volta.
    this.pattern = new RegExp(`${usablePrefix}[a-z0-9]{${TOKEN_BODY_LENGTH}}`, 'g');

    this.store = new BoundedStore({
      maxEntries: options.maxTokens > 0 ? options.maxTokens : 5000,
      ttlSeconds: options.ttlHours > 0 ? options.ttlHours * 3600 : 72 * 3600,
    });

    this.mintedTotal = 0;
    this.triggeredTotal = 0;
    this.recentTriggers = [];
  }

  /**
   * Conia un token e ne registra il destinatario.
   *
   * @param {object} [recipient] - { ip, fp, path }
   * @returns {string} il token
   */
  mint(recipient = {}) {
    const bytes = crypto.randomBytes(TOKEN_BODY_LENGTH);
    let body = '';
    for (let i = 0; i < TOKEN_BODY_LENGTH; i++) {
      body += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
    }
    const token = `${this.prefix}${body}`;

    this.store.touch(token, {
      mintedAt: Date.now(),
      ip: recipient.ip || null,
      fp: recipient.fp || null,
      path: recipient.path || null,
    });
    this.mintedTotal++;

    return token;
  }

  /**
   * Cerca un token in una stringa (percorso, querystring…).
   *
   * @param {string} text
   * @returns {string|null} il primo token trovato, o null
   */
  find(text) {
    if (typeof text !== 'string' || text.length === 0) return null;
    // `lastIndex` di una regex globale sopravvive fra le chiamate: azzerarlo è
    // obbligatorio, altrimenti una richiesta su due salterebbe il match.
    this.pattern.lastIndex = 0;
    const found = this.pattern.exec(text);
    return found ? found[0] : null;
  }

  /**
   * Verifica un token e, se lo riconosce, restituisce chi l'aveva ricevuto.
   *
   * NON consuma il token: un attaccante che lo usa dieci volte deve inciampare
   * dieci volte nella trappola. Un token monouso trasformerebbe l'insistenza —
   * che è essa stessa un segnale — in silenzio dopo la prima richiesta.
   *
   * NON ne rinfresca nemmeno la scadenza: la vita del token si conta dalla
   * CONSEGNA, non dall'ultimo uso. Altrimenti basterebbe usarlo a intervalli
   * regolari per tenerlo vivo per sempre, cioè lasciare all'attaccante il
   * controllo di quanto a lungo occupiamo memoria per lui.
   *
   * @param {string} token
   * @returns {{ status: 'known'|'unknown', mintedAt: number|null, ip: string|null, fp: string|null, path: string|null }}
   */
  verify(token) {
    const entry = this.store.get(token);
    if (!entry) {
      return { status: 'unknown', mintedAt: null, ip: null, fp: null, path: null };
    }
    return {
      status: 'known',
      mintedAt: entry.mintedAt,
      ip: entry.ip,
      fp: entry.fp,
      path: entry.path,
    };
  }

  /**
   * Registra l'uso di un token, per le statistiche e per l'allerta.
   *
   * @param {object} info - { token, status, usedBy: { ip, fp, path }, deliveredTo }
   */
  recordTrigger(info) {
    this.triggeredTotal++;
    this.recentTriggers.unshift({ at: Date.now(), ...info });
    if (this.recentTriggers.length > 50) this.recentTriggers.length = 50;
  }

  sweep() {
    return this.store.sweep();
  }

  getStats() {
    return {
      prefix: this.prefix,
      minted: this.mintedTotal,
      triggered: this.triggeredTotal,
      liveTokens: this.store.size,
      evictions: this.store.evictions,
      recentTriggers: this.recentTriggers.slice(0, 20),
    };
  }
}

/**
 * Cerca un token nella richiesta e ne stabilisce lo stato.
 *
 * Sta qui, e non nel matcher, perché il risultato dev'essere calcolato **una
 * volta per richiesta** e messo nel soggetto: la scansione tocca percorso e
 * querystring, e ripeterla per ogni regola sarebbe un costo pagato da tutto il
 * traffico per una condizione che quasi nessuna richiesta soddisfa.
 *
 * La querystring si guarda anche decodificata, per lo stesso motivo per cui lo
 * fa `matchQuery`: un token dentro un parametro può arrivare percent-encoded, e
 * confrontare solo la forma grezza lo lascerebbe passare.
 *
 * @param {CanaryRegistry|null} registry
 * @param {string} reqPath
 * @param {string} [query]
 * @returns {{ token: string, status: string, deliveredTo: object }|null}
 */
function findCanary(registry, reqPath, query) {
  if (!registry) return null;

  let token = registry.find(reqPath);
  if (!token && query) {
    token = registry.find(query);
    if (!token) {
      let decoded = null;
      try { decoded = decodeURIComponent(String(query).replace(/\+/g, ' ')); } catch (_err) { decoded = null; }
      if (decoded && decoded !== query) token = registry.find(decoded);
    }
  }
  if (!token) return null;

  const verified = registry.verify(token);
  return { token, status: verified.status, deliveredTo: verified };
}

module.exports = {
  CanaryRegistry,
  findCanary,
  DEFAULT_PREFIX,
  TOKEN_BODY_LENGTH,
};
