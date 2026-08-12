/**
 * reputation.js — cosa dice la storia locale di un'impronta
 *
 * Il censimento accumula da mesi: quante richieste ha fatto ogni impronta, da
 * quanti indirizzi, quanti percorsi distinti, e quante volte è stata bloccata.
 * Qui quel materiale diventa un giudizio utilizzabile in una regola.
 *
 * ─── I DUE MODI IN CUI UNA REPUTAZIONE FA DANNI ───────────────────────────────
 *
 * **1. Un'impronta NON è una persona: è una famiglia di client.**
 * `Chrome 120 su Linux` è la stessa impronta per tutti quelli che usano Chrome
 * 120 su Linux. Se qualcuno attacca con un Chrome perfettamente ordinario e la
 * reputazione condanna quell'impronta, si chiude fuori **ogni visitatore con
 * quel browser**. Non è un rischio teorico: è il modo più probabile in cui
 * questa funzione rovina un sito.
 *
 * Da qui la protezione che non si disattiva per distrazione: un'impronta
 * **coerente e con profilo da browser** non può ricevere un giudizio negativo,
 * per quanto sporca sia la sua storia. Il prezzo è dichiarato — chi emula Chrome
 * alla perfezione è immune alla reputazione — ed è il prezzo giusto: la
 * reputazione è una vittoria facile contro gli scanner pigri, non uno strumento
 * a cui affidare la difesa da un avversario capace.
 *
 * **2. La reputazione può alimentare sé stessa.**
 * Se la quota di blocchi determina il giudizio, e il giudizio produce blocchi,
 * il primo inciampo condanna per sempre. Il conteggio dei blocchi esclude quindi
 * quelli decisi **da una regola che usa la reputazione**: il giudizio si basa
 * solo su prove raccolte da altri. Il validatore marca quelle regole
 * (`usesReputation`) e il motore le tiene fuori dal contatore.
 *
 * ─── IL LIMITE DA DIRE AD ALTA VOCE ───────────────────────────────────────────
 * L'impronta la controlla chi bussa. Chi randomizza l'ordine degli header ha
 * un'impronta nuova a ogni richiesta, quindi una reputazione sempre pulita: la
 * reputazione **non ferma un attaccante determinato**, ferma quello pigro — che
 * però è la stragrande maggioranza del traffico ostile.
 *
 * E non è un buco silenzioso: randomizzare le impronte fa esplodere il tasso di
 * sfratto del censimento, che ha già la sua allerta (vedi `alertDispatcher`).
 * L'evasione da questa funzione accende l'altra.
 */

'use strict';

/**
 * I tre giudizi, in ordine di gravità.
 *
 * `burst` non è un giudizio sulla storia — è l'assenza di storia unita alla
 * fretta: un'impronta mai vista che nei primi secondi ha già fatto decine di
 * richieste. Sta qui perché si ricava dagli stessi dati e perché in una regola
 * si usa allo stesso modo.
 */
const LEVELS = ['burst', 'suspect', 'bad'];

const DEFAULTS = {
  minRequests: 20,
  suspectShare: 0.2,
  badShare: 0.5,
  burstWindowSeconds: 60,
  burstMinRequests: 30,
  protectBrowserFingerprints: true,
};

/**
 * Un'impronta che sembra un browser vero è condivisa da tutti quelli che usano
 * quel browser: condannarla significa chiudere fuori loro, non l'attaccante.
 */
function isSharedBrowserFingerprint(fpClass) {
  if (!fpClass) return false;
  return fpClass.coherent === true && fpClass.headerProfile === 'browser';
}

/**
 * Classifica un'impronta a partire dalla sua voce di censimento.
 *
 * @param {object|null} entry   - voce del censimento, o null se mai vista
 * @param {object} fpClass      - decomposizione dell'impronta della richiesta
 * @param {object} [config]     - `custom.reputation`
 * @returns {{ levels: string[], requests: number, blockedShare: number, ageSeconds: number, protected: boolean }}
 */
function classify(entry, fpClass, config = {}) {
  const conf = { ...DEFAULTS, ...config };
  const protectedFp = conf.protectBrowserFingerprints !== false
    && isSharedBrowserFingerprint(fpClass);

  if (!entry) {
    // Mai vista: non è né buona né cattiva, è sconosciuta. `burst` richiede
    // almeno un po' di storia per essere misurabile, e con zero richieste non
    // c'è nemmeno quella.
    return { levels: [], requests: 0, blockedShare: 0, ageSeconds: 0, protected: protectedFp };
  }

  // Denominatore: le richieste giudicate NEL MERITO, non tutte. Una richiesta
  // decisa da una regola di reputazione è stata decisa dal giudizio stesso, e
  // contarla farebbe scendere la quota mentre il giudizio è in vigore — fino a
  // perdonare l'impronta solo perché la si stava bloccando.
  const requests = entry.judgedCount === undefined ? (entry.count || 0) : entry.judgedCount;
  const blocked = entry.blockedCount || 0;
  const blockedShare = requests > 0 ? blocked / requests : 0;
  const ageSeconds = Math.max(0, Math.round((Date.now() - (entry.firstSeenMs || Date.now())) / 1000));

  const levels = [];

  // ── burst: comparsa adesso, e già a raffica ──
  // Un client legittimo nuovo carica una pagina e le sue risorse: qualche
  // richiesta. Decine nei primi secondi da un'impronta mai vista prima non è il
  // profilo di una visita, è il profilo di una scansione.
  if (ageSeconds <= conf.burstWindowSeconds && requests >= conf.burstMinRequests) {
    levels.push('burst');
  }

  // ── suspect / bad: la storia dei blocchi ──
  // Sotto `minRequests` non si giudica: una quota calcolata su tre richieste è
  // rumore, e condannare per rumore è esattamente come si ottengono i falsi
  // positivi che questo plugin è costruito per evitare.
  if (!protectedFp && requests >= conf.minRequests) {
    if (blockedShare >= conf.badShare) levels.push('bad');
    else if (blockedShare >= conf.suspectShare) levels.push('suspect');
  }

  return { levels, requests, blockedShare: Math.round(blockedShare * 1000) / 1000, ageSeconds, protected: protectedFp };
}

module.exports = { classify, isSharedBrowserFingerprint, LEVELS, DEFAULTS };
