/**
 * sessionCoherence.js
 *
 * Sorveglia se una sessione autenticata continua ad assomigliare a sé stessa.
 *
 * ─── IL SEGNALE ───────────────────────────────────────────────────────────────
 * Un cookie di sessione rubato funziona. È tutto il punto del furto: chi lo
 * presenta *è* l'utente, per il server. Nessun controllo di password lo ferma,
 * nessun controllo di ruolo, nessun rate limit — perché non c'è niente da
 * indovinare e niente da forzare.
 *
 * L'unica cosa che il ladro non eredita insieme al cookie è il **client**. La
 * sessione era nata su un Firefox su Linux da un certo indirizzo, e da un certo
 * momento in poi arriva da `python-requests`. Il cookie è quello giusto, la
 * sessione è quella giusta, ma non è più la stessa persona a usarla.
 *
 * Fra i segnali di questo plugin è quello con il rapporto migliore fra forza e
 * falsi positivi: un browser **non cambia User-Agent a metà sessione**.
 *
 * ─── LA LINEA DI BASE NON SI AGGIORNA MAI ─────────────────────────────────────
 * La prima richiesta che vediamo per una sessione fissa il riferimento, e da lì
 * non si tocca più. È deliberato, e la ragione è che l'alternativa è inutile: se
 * dopo un'anomalia si adottasse il nuovo valore come riferimento, la richiesta
 * successiva del ladro tornerebbe "coerente" e la sessione dirottata risulterebbe
 * pulita per tutto il resto della sua vita. Non aggiornando, una sessione che ha
 * cambiato pelle resta segnalata finché non scade — che è esattamente il
 * comportamento che serve se la regola la blocca.
 *
 * Il prezzo è dichiarato: un utente mobile che passa da rete dati a WiFi resta
 * marcato `ipChanged` fino al logout. Per questo `ipChanged` non compare nella
 * regola distribuita, e `uaChanged` sì.
 *
 * ─── PERCHE SOLO LE SESSIONI AUTENTICATE ──────────────────────────────────────
 * Due ragioni che portano alla stessa conclusione. La prima è di merito: una
 * sessione anonima non ha niente da rubare, il segnale non descriverebbe nulla.
 * La seconda è che tracciare le sessioni anonime richiederebbe di **crearle**, e
 * creare una sessione significa mandare un cookie a ogni visitatore del sito —
 * un cambiamento di comportamento che si porta dietro conseguenze (banner,
 * informativa) del tutto sproporzionate al segnale.
 *
 * ─── LIMITE NOTO: LO STATO E IN MEMORIA ───────────────────────────────────────
 * Dopo un riavvio le linee di base si perdono, e la prima richiesta successiva
 * di ogni sessione ne fissa una nuova — su come il client appare *in quel
 * momento*. Se il riavvio capita a dirottamento già avvenuto, la sessione
 * risulterà coerente. Lo stesso vale per worker diversi in cluster. È il motivo
 * per cui questo è un sensore in più e non l'unico presidio sulle sessioni.
 */

'use strict';

const crypto = require('crypto');
const BoundedStore = require('./boundedStore');

/**
 * Chiave con cui l'identificativo di sessione viene riposto nella sessione.
 *
 * ─── DUE VINCOLI, ENTRAMBI SCOPERTI SUL CAMPO ─────────────────────────────────
 * 1. **Non può iniziare con `_`.** Il `toJSON()` di koa-session salta ogni chiave
 *    che comincia per underscore («skip private stuff»), quindi un
 *    `_sentinelSid` non finirebbe mai nel cookie: a ogni richiesta se ne
 *    conierebbe uno nuovo, ogni richiesta sembrerebbe la prima della sua
 *    sessione, e nessuna anomalia potrebbe essere rilevata. Il modulo
 *    funzionerebbe in ogni suo test e non direbbe mai niente.
 * 2. **Non deve nominare il plugin.** Il contenuto della sessione viaggia in un
 *    cookie che il client può decodificare (è firmato, non cifrato). Una chiave
 *    `sentinelSid` annuncerebbe l'esistenza del filtro a chiunque guardi i propri
 *    cookie — la stessa informazione che il 404 di copertura esiste per negare.
 *    `sid` è quello che scriverebbe un framework qualsiasi, ed è il punto.
 */
const SESSION_ID_KEY = 'sid';

/**
 * Anomalie riconosciute, in ordine di affidabilità decrescente.
 *
 * `scriptClient` non è un cambiamento ma uno **stato**: non dice «questa
 * sessione è cambiata», dice «questa sessione, adesso, è in mano a qualcosa che
 * non è un browser». Un `python-requests` con un cookie valido è già di per sé
 * la descrizione di un problema, anche se ha usato quel cookie fin dall'inizio.
 */
const ANOMALY_KINDS = [
  'uaChanged',
  'fingerprintChanged',
  'networkChanged',
  'ipChanged',
  'scriptClient',
];

/**
 * Blocco di rete dell'indirizzo: /24 per IPv4, /48 per IPv6.
 *
 * Serve a separare «l'operatore mobile mi ha cambiato indirizzo» — che dentro lo
 * stesso blocco è ordinaria amministrazione — da «questa sessione arriva da
 * un'altra parte del mondo». Resta un segnale rumoroso, solo meno.
 */
function networkOf(ip) {
  if (typeof ip !== 'string' || ip === '') return '';
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':');
  return ip.split('.').slice(0, 3).join('.');
}

class SessionCoherence {
  /**
   * @param {object} [options]
   * @param {number} [options.maxSessions]
   * @param {number} [options.ttlHours]
   */
  constructor(options = {}) {
    this.store = new BoundedStore({
      maxEntries: options.maxSessions > 0 ? options.maxSessions : 5000,
      ttlSeconds: options.ttlHours > 0 ? options.ttlHours * 3600 : 24 * 3600,
    });

    this.tracked = 0;      // sessioni prese in carico da questo processo
    this.flagged = 0;      // sessioni che hanno mostrato almeno un'anomalia
    this.byKind = Object.fromEntries(ANOMALY_KINDS.map((k) => [k, 0]));
    this.recent = [];
  }

  /**
   * Recupera (o conia) l'identificativo di sessione.
   *
   * ─── PERCHE UN IDENTIFICATIVO PROPRIO ─────────────────────────────────────
   * Servirebbe una chiave stabile per tutta la vita della sessione, e nella
   * sessione non ce n'è. `_expire` sembra adatto ma viene **riscritto a ogni
   * salvataggio**: qualunque cosa modifichi la sessione — la rotazione del token
   * CSRF, per dirne una — lo sposterebbe, azzerando la linea di base. Sarebbe un
   * modo per un attaccante di ripulirsi da solo. Lo username, dal canto suo,
   * identifica la persona e non la sessione: chi entra da portatile e telefono
   * risulterebbe subito incoerente.
   *
   * Si scrive quindi un identificativo nella sessione, e **solo** su sessioni
   * autenticate — che il cookie ce l'hanno già. La scrittura avviene una volta
   * sola; da lì in poi si legge e basta.
   *
   * @param {object} session - ctx.session (già verificato autenticato)
   * @returns {string|null} null se la sessione non è scrivibile
   */
  static resolveSessionId(session) {
    if (!session || typeof session !== 'object') return null;

    const existing = session[SESSION_ID_KEY];
    if (typeof existing === 'string' && existing.length > 0) return existing;

    try {
      const minted = crypto.randomBytes(12).toString('base64url');
      session[SESSION_ID_KEY] = minted;
      return minted;
    } catch (_err) {
      // Sessione non scrivibile (implementazione diversa, oggetto congelato):
      // si rinuncia al tracciamento invece di far fallire la richiesta.
      return null;
    }
  }

  /**
   * Confronta la richiesta con la linea di base della sua sessione.
   *
   * @param {string} sessionId
   * @param {object} observation - { userAgent, fp, ip, isScriptClient, username }
   * @returns {{ anomalies: string[], firstSeenMs: number, requests: number }}
   */
  observe(sessionId, observation) {
    const existing = this.store.get(sessionId);

    if (!existing) {
      // Prima comparsa: fissa il riferimento. Per costruzione non può essere
      // un'anomalia — non c'è ancora niente con cui confrontarla.
      this.tracked++;
      this.store.touch(sessionId, {
        firstSeenMs: Date.now(),
        userAgent: observation.userAgent || '',
        fp: observation.fp || '',
        ip: observation.ip || '',
        network: networkOf(observation.ip),
        username: observation.username || null,
        requests: 1,
        seenAnomalies: [],
      });
      return { anomalies: [], firstSeenMs: Date.now(), requests: 1 };
    }

    const anomalies = [];
    if ((observation.userAgent || '') !== existing.userAgent) anomalies.push('uaChanged');
    if ((observation.fp || '') !== existing.fp) anomalies.push('fingerprintChanged');
    if (networkOf(observation.ip) !== existing.network) anomalies.push('networkChanged');
    if ((observation.ip || '') !== existing.ip) anomalies.push('ipChanged');
    if (observation.isScriptClient) anomalies.push('scriptClient');

    existing.requests++;

    // Le anomalie già viste per questa sessione non si ricontano nelle
    // statistiche: una sessione dirottata produce l'anomalia a OGNI richiesta
    // successiva, e sommarle direbbe quanto è stata attiva, non quante sessioni
    // sono state compromesse. Sul verdetto invece si riportano sempre, perché la
    // regola deve poter agire su ciascuna di quelle richieste.
    const nuove = anomalies.filter((a) => !existing.seenAnomalies.includes(a));
    if (nuove.length > 0) {
      if (existing.seenAnomalies.length === 0) this.flagged++;
      for (const kind of nuove) {
        existing.seenAnomalies.push(kind);
        this.byKind[kind]++;
      }
      this.recent.unshift({
        at: Date.now(),
        username: existing.username,
        anomalies: nuove.slice(),
        baselineIp: existing.ip,
        currentIp: observation.ip || null,
        sessionAgeMs: Date.now() - existing.firstSeenMs,
      });
      if (this.recent.length > 50) this.recent.length = 50;
    }

    // `touch` rinnova la scadenza ma NON la linea di base: la sessione resta
    // viva finché è usata, e continua a essere confrontata con com'era all'inizio.
    this.store.touch(sessionId, existing);

    return { anomalies, firstSeenMs: existing.firstSeenMs, requests: existing.requests };
  }

  sweep() {
    return this.store.sweep();
  }

  getStats() {
    return {
      tracked: this.tracked,
      live: this.store.size,
      flagged: this.flagged,
      evictions: this.store.evictions,
      byKind: { ...this.byKind },
      recent: this.recent.slice(0, 20),
    };
  }
}

module.exports = {
  SessionCoherence,
  ANOMALY_KINDS,
  SESSION_ID_KEY,
  networkOf,
};
