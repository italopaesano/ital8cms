/**
 * alertDispatcher.js
 *
 * Canale unico delle allerte operative: budget disco vicino al limite, tasso di
 * sfratto anomalo, canary scattato.
 *
 * ─── PERCHE UN DISPATCHER E NON UNA CHIAMATA A MAILER ─────────────────────────
 * Perché la cosa difficile non è mandare l'email: è **non mandarne diecimila**.
 * Le allerte di questo plugin nascono da eventi che l'attaccante controlla — un
 * canary lo può richiedere in ciclo, la crescita del log la detta lui. Un
 * `mailer.send()` diretto dentro il percorso dell'evento trasformerebbe la
 * notifica nel moltiplicatore dell'attacco: la casella dell'amministratore
 * satura, il provider SMTP inizia a rifiutare, e l'allerta che conta arriva
 * mescolata a novemilanovecento copie di sé stessa.
 *
 * Da qui le due regole di questo modulo:
 *   1. **Una finestra di silenzio per genere.** Dopo la prima allerta di un
 *      certo tipo, le successive dello stesso tipo vengono contate e non
 *      spedite; alla riapertura della finestra parte un solo messaggio che dice
 *      quante ne sono state soppresse. Il conteggio è esso stesso informazione:
 *      «canary scattato 412 volte nell'ultima ora» vale più di 412 email.
 *   2. **Il log non è mai soppresso.** La finestra vale per la posta; il log
 *      applicativo riceve tutto. Un'allerta che esiste solo se la posta funziona
 *      è un'allerta che manca proprio quando serve — e la posta è la prima cosa
 *      che smette di funzionare quando la macchina è sotto pressione.
 *
 * ─── FAIL-SOFT ────────────────────────────────────────────────────────────────
 * Nessun percorso di questo modulo può lanciare verso il chiamante: le allerte
 * partono da dentro la gestione di una richiesta, e un errore SMTP non deve mai
 * diventare un 500 per chi sta navigando.
 */

'use strict';

const DEFAULT_COOLDOWN_MINUTES = 60;

/**
 * Genere delle allerte, con la loro gravità.
 *
 * La gravità non cambia il comportamento del dispatcher: finisce nell'oggetto
 * dell'email, perché chi la riceve sul telefono alle tre di notte deve capire
 * dalla riga dell'oggetto se alzarsi.
 */
const ALERT_SEVERITY = {
  diskBudget: 'warning',
  evictionRate: 'warning',
  canaryTriggered: 'critical',
};

class AlertDispatcher {
  /**
   * @param {object} deps
   * @param {Function} deps.log            - (level, message) => void
   * @param {Function} deps.getRecipient   - () => string|null
   * @param {Function} deps.getMailer      - () => object|null
   * @param {number}  [deps.cooldownMinutes]
   */
  constructor(deps = {}) {
    this.log = typeof deps.log === 'function' ? deps.log : () => {};
    this.getRecipient = typeof deps.getRecipient === 'function' ? deps.getRecipient : () => null;
    this.getMailer = typeof deps.getMailer === 'function' ? deps.getMailer : () => null;
    this.cooldownMs = (deps.cooldownMinutes > 0 ? deps.cooldownMinutes : DEFAULT_COOLDOWN_MINUTES) * 60000;

    /** @type {Map<string, { lastSentAt: number, suppressed: number }>} */
    this.windows = new Map();

    this.sentTotal = 0;
    this.suppressedTotal = 0;
  }

  /**
   * Segnala un evento. Sempre loggato, spedito solo se la finestra è aperta.
   *
   * @param {string} kind    - genere (chiave della finestra di silenzio)
   * @param {object} payload - dati dell'evento, finiscono nel corpo del messaggio
   * @returns {{ logged: boolean, mailed: boolean, suppressed: boolean }}
   */
  notify(kind, payload = {}) {
    const severity = ALERT_SEVERITY[kind] || 'info';
    const level = severity === 'critical' ? 'error' : 'warn';

    this.log(level, `allerta [${kind}] ${summarize(payload)}`);

    const window = this.windows.get(kind);
    const now = Date.now();

    if (window && (now - window.lastSentAt) < this.cooldownMs) {
      window.suppressed++;
      this.suppressedTotal++;
      return { logged: true, mailed: false, suppressed: true };
    }

    const suppressedSincePrevious = window ? window.suppressed : 0;
    this.windows.set(kind, { lastSentAt: now, suppressed: 0 });

    const mailed = this.send(kind, severity, payload, suppressedSincePrevious);
    if (mailed) this.sentTotal++;

    return { logged: true, mailed, suppressed: false };
  }

  /** @returns {boolean} true se il messaggio è stato consegnato al mailer */
  send(kind, severity, payload, suppressedSincePrevious) {
    const recipient = this.getRecipient();
    if (!recipient) return false;

    const mailer = this.getMailer();
    if (!mailer || typeof mailer.send !== 'function') return false;

    const lines = [
      `Evento: ${kind}`,
      `Gravità: ${severity}`,
      `Istante: ${new Date().toISOString()}`,
      '',
      JSON.stringify(payload, null, 2),
    ];
    if (suppressedSincePrevious > 0) {
      lines.push(
        '',
        `Nella finestra precedente ci sono state altre ${suppressedSincePrevious} ` +
        'occorrenze di questo stesso evento, non notificate per non saturare la casella. ' +
        'Il log applicativo le contiene tutte.'
      );
    }

    try {
      // Deliberatamente senza `await`: chi chiama sta servendo una richiesta, e
      // l'attesa della coda SMTP non deve entrare nel suo tempo di risposta.
      // `mailer` ha una coda persistente propria, quindi il messaggio non si
      // perde. Il `catch` sulla promise evita un unhandled rejection.
      const outcome = mailer.send({
        to: recipient,
        subject: `[sentinel] ${severity.toUpperCase()} — ${kind}`,
        text: lines.join('\n'),
      });
      if (outcome && typeof outcome.catch === 'function') {
        outcome.catch((err) => this.log('warn', `invio allerta [${kind}] fallito: ${err.message}`));
      }
      return true;
    } catch (err) {
      this.log('warn', `invio allerta [${kind}] fallito: ${err.message}`);
      return false;
    }
  }

  getStats() {
    const perKind = {};
    for (const [kind, window] of this.windows) {
      perKind[kind] = { lastSentAt: window.lastSentAt, suppressedInWindow: window.suppressed };
    }
    return {
      cooldownMinutes: Math.round(this.cooldownMs / 60000),
      sent: this.sentTotal,
      suppressed: this.suppressedTotal,
      perKind,
    };
  }
}

/** Riassunto a una riga per il log applicativo. */
function summarize(payload) {
  return Object.entries(payload)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ') || '(nessun dettaglio)';
}

module.exports = { AlertDispatcher, ALERT_SEVERITY, DEFAULT_COOLDOWN_MINUTES };
