/**
 * SINGLE PROCESS LOCK — l'installazione è single-process, e ora il boot lo sa
 *
 * ital8cms archivia i dati su **file**: account, ruoli, configurazioni, stato
 * del rate limiter, contatori dei redirect. Nessuna di queste scritture ha un
 * lock fra processi — `core/json5UpdateQueue.js` serializza, ma la sua coda vive
 * **in memoria**, quindi copre un solo processo (REVIEW.md → B1, B2).
 *
 * ─── IL PROBLEMA (REVIEW.md → B7) ────────────────────────────────────────────
 * I documenti raccomandano `pm2`. Alla prima persona che scrive
 *
 *     pm2 start index.js -i max
 *
 * — che è **il motivo per cui si usa pm2** — partono N processi che condividono
 * le stesse cartelle. Da quel momento due richieste servite da processi diversi
 * possono leggere lo stesso file, modificarlo e riscriverlo: una delle due
 * modifiche sparisce, e nessuno dei due processi se ne accorge.
 *
 * ─── LA STRADA SCELTA: DICHIARARLO E RILEVARLO ───────────────────────────────
 * Lo storage con lock fra processi è lavoro grosso, e la scelta « single-process
 * per sempre » vincolerebbe il futuro del progetto: la decisione resta aperta.
 * Quello che non deve restare è il **silenzio**. Una sola riga di documentazione
 * non ferma chi scrive `-i max` senza leggerla; questo lock sì, e con un
 * messaggio che dice cosa fare.
 *
 * ─── PERCHÉ UN FILE CON PID E RADICE, E NON UN LOCKFILE CLASSICO ─────────────
 * Un lockfile « vero » andrebbe gestito su crash, timeout e lock orfani. Qui il
 * file contiene **il PID e la radice del progetto**, e questo basta:
 *
 *  - PID non più vivo → lock **orfano**, si prende il posto (un crash non
 *    richiede intervento manuale: è il caso più frequente e deve risolversi da
 *    sé, altrimenti il rimedio diventa peggio del male);
 *  - radice diversa da quella corrente → il file è stato **copiato**, non
 *    ereditato. Succede davvero: i test d'integrazione copiano l'intero progetto
 *    in una tmpdir, e senza questo controllo un lock copiato con un PID vivo
 *    (il server di sviluppo di chi lancia i test) bloccherebbe ogni fixture con
 *    un errore incomprensibile.
 *
 * @module core/singleProcessLock
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LOCK_FILENAME = 'ital8cms.lock';

/** Il PID è ancora vivo? `kill(pid, 0)` non invia nulla: interroga. */
function processoVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = esiste ma è di un altro utente → vivo.
    return err.code === 'EPERM';
  }
}

/** Legge il lock, o null se assente/illeggibile/malformato. */
function leggiLock(lockPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return { pid: Number(raw.pid), projectRoot: String(raw.projectRoot || ''), startedAt: raw.startedAt };
  } catch (_) {
    return null;
  }
}

/**
 * Prova a prendere il lock per questa installazione.
 *
 * @param {object} [options]
 * @param {string} [options.projectRoot] - Radice del progetto (default: cwd)
 * @returns {{acquired: boolean, lockPath: string, heldBy: object|null, reason: string}}
 *   `acquired: false` → un altro processo sta già servendo questa cartella.
 *   `reason`: 'free' | 'stale' | 'copied' | 'held'
 */
function acquireSingleProcessLock(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const lockPath = path.join(projectRoot, LOCK_FILENAME);
  const esistente = leggiLock(lockPath);

  let reason = 'free';
  if (esistente) {
    if (path.resolve(esistente.projectRoot || '') !== projectRoot) {
      reason = 'copied';                       // file copiato da un'altra installazione
    } else if (!processoVivo(esistente.pid)) {
      reason = 'stale';                        // il titolare non c'è più
    } else if (esistente.pid === process.pid) {
      reason = 'stale';                        // siamo noi (riavvio in-process)
    } else {
      return { acquired: false, lockPath, heldBy: esistente, reason: 'held' };
    }
  }

  try {
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, projectRoot, startedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch (err) {
    // Fail-soft: su un filesystem di sola lettura il lock non si può scrivere,
    // e rifiutare l'avvio per questo sarebbe peggio del rischio che evita — il
    // gate delle data dir scrivibili copre già i casi che contano.
    console.warn(`[LOCK] impossibile scrivere ${LOCK_FILENAME} (si prosegue): ${err.message}`);
  }

  return { acquired: true, lockPath, heldBy: null, reason };
}

/** Rilascia il lock, ma solo se è ancora nostro. */
function releaseSingleProcessLock(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const lockPath = path.join(projectRoot, LOCK_FILENAME);
  const esistente = leggiLock(lockPath);

  // Non si cancella il lock di qualcun altro: se il nostro è stato preso da un
  // processo più recente, togliere il file lo lascerebbe senza protezione.
  if (!esistente || esistente.pid !== process.pid) return false;

  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch (_) {
    return false;
  }
}

/** Il box che spiega cosa sta succedendo e cosa fare. */
function warnAlreadyRunning(heldBy, lockPath) {
  const lines = [
    '[LOCK] ══════════════════════════════════════════════════════════',
    '[LOCK]  🔴  UN ALTRO PROCESSO STA GIÀ SERVENDO QUESTA INSTALLAZIONE',
    '[LOCK] ══════════════════════════════════════════════════════════',
    `[LOCK]    PID in esecuzione: ${heldBy.pid}`,
    `[LOCK]    avviato:           ${heldBy.startedAt || 'sconosciuto'}`,
    `[LOCK]    lock:              ${lockPath}`,
    '[LOCK]',
    '[LOCK]  ital8cms archivia i dati su FILE e non ha lock fra processi: due',
    '[LOCK]  istanze sulla stessa cartella si sovrascrivono le modifiche a vicenda,',
    '[LOCK]  in silenzio. Account, ruoli, configurazioni e stato del rate limiter',
    '[LOCK]  possono perdere scritture senza che nulla lo segnali.',
    '[LOCK]',
    '[LOCK]  ⚠  In particolare NON usare il cluster mode di pm2:',
    '[LOCK]',
    '[LOCK]      pm2 start index.js -i max      ← NO: avvia N processi',
    '[LOCK]      pm2 start index.js             ← sì: un processo solo',
    '[LOCK]',
    '[LOCK]  Opzione A — ferma l\'istanza già attiva:',
    '[LOCK]',
    `[LOCK]      kill ${heldBy.pid}        # oppure: pm2 stop ital8cms`,
    '[LOCK]',
    '[LOCK]  Opzione B — se quel processo non esiste più (lock orfano dopo un',
    '[LOCK]  crash, normalmente riconosciuto da sé), rimuovi il file:',
    '[LOCK]',
    `[LOCK]      rm ${lockPath}`,
    '[LOCK]',
    '[LOCK]  Per servire più traffico: un reverse proxy davanti a UNA istanza,',
    '[LOCK]  oppure più installazioni con cartelle dati separate.',
    '[LOCK]',
    '[LOCK]  ▶ Avvio interrotto.',
    '[LOCK] ══════════════════════════════════════════════════════════',
  ];
  for (const line of lines) console.error(line);
}

module.exports = {
  acquireSingleProcessLock,
  releaseSingleProcessLock,
  warnAlreadyRunning,
  LOCK_FILENAME,
};
