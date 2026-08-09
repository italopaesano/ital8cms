/**
 * alertDispatcher.test.js
 *
 * La cosa difficile di un'allerta non è mandarla: è non mandarne diecimila.
 * Gli eventi che generano allerte in questo plugin partono da azioni che
 * l'attaccante controlla — un canary lo può richiedere in ciclo — quindi senza
 * finestra di silenzio la notifica diventa il moltiplicatore dell'attacco.
 *
 * I test qui sotto difendono tre proprietà, e la seconda è quella che conta:
 *   1. la finestra sopprime le email ripetute dello stesso genere;
 *   2. il LOG non è mai soppresso, e nulla di tutto ciò dipende dalla posta;
 *   3. niente di tutto questo può lanciare verso chi sta servendo una richiesta.
 */

'use strict';

const { AlertDispatcher } = require('../../lib/alertDispatcher');

function makeDispatcher(over = {}) {
  const logged = [];
  const mailed = [];
  const dispatcher = new AlertDispatcher({
    log: (level, message) => logged.push({ level, message }),
    getRecipient: () => 'ops@esempio.test',
    getMailer: () => ({ send: (msg) => { mailed.push(msg); return Promise.resolve('id'); } }),
    cooldownMinutes: 60,
    ...over,
  });
  return { dispatcher, logged, mailed };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('finestra di silenzio', () => {
  test('la prima allerta parte', () => {
    const { dispatcher, mailed } = makeDispatcher();
    const outcome = dispatcher.notify('canaryTriggered', { token: 'a7xxx' });

    expect(outcome).toEqual({ logged: true, mailed: true, suppressed: false });
    expect(mailed).toHaveLength(1);
  });

  test('le successive dello stesso genere vengono soppresse', () => {
    const { dispatcher, mailed } = makeDispatcher();
    for (let i = 0; i < 100; i++) dispatcher.notify('canaryTriggered', { i });

    expect(mailed).toHaveLength(1);
    expect(dispatcher.getStats().suppressed).toBe(99);
  });

  test('generi diversi hanno finestre indipendenti', () => {
    // Un canary in ciclo non deve zittire l'allerta del disco pieno: sono due
    // problemi diversi, e il secondo può arrivare proprio a causa del primo.
    const { dispatcher, mailed } = makeDispatcher();
    dispatcher.notify('canaryTriggered', {});
    dispatcher.notify('canaryTriggered', {});
    dispatcher.notify('diskBudget', {});
    dispatcher.notify('evictionRate', {});

    expect(mailed).toHaveLength(3);
  });

  test('scaduta la finestra riparte, dicendo quante ne ha soppresse', () => {
    // Il conteggio è esso stesso informazione: «412 volte nell'ultima ora»
    // descrive l'attacco meglio di 412 email identiche.
    const { dispatcher, mailed } = makeDispatcher();
    dispatcher.notify('canaryTriggered', {});
    for (let i = 0; i < 411; i++) dispatcher.notify('canaryTriggered', {});

    dispatcher.windows.get('canaryTriggered').lastSentAt = Date.now() - 61 * 60000;
    dispatcher.notify('canaryTriggered', {});

    expect(mailed).toHaveLength(2);
    expect(mailed[1].text).toContain('411');
  });

  test('il contatore delle soppressioni riparte da zero a finestra nuova', () => {
    const { dispatcher, mailed } = makeDispatcher();
    dispatcher.notify('diskBudget', {});
    dispatcher.notify('diskBudget', {});
    dispatcher.windows.get('diskBudget').lastSentAt = Date.now() - 61 * 60000;
    dispatcher.notify('diskBudget', {});
    dispatcher.notify('diskBudget', {});
    dispatcher.windows.get('diskBudget').lastSentAt = Date.now() - 61 * 60000;
    dispatcher.notify('diskBudget', {});

    expect(mailed[2].text).toContain('1');
    expect(mailed).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('il log non dipende dalla posta', () => {
  test('ogni occorrenza finisce nel log, comprese le soppresse', () => {
    const { dispatcher, logged, mailed } = makeDispatcher();
    for (let i = 0; i < 10; i++) dispatcher.notify('canaryTriggered', {});

    expect(logged).toHaveLength(10);
    expect(mailed).toHaveLength(1);
  });

  test('senza destinatario si logga lo stesso', () => {
    const { dispatcher, logged, mailed } = makeDispatcher({ getRecipient: () => null });
    const outcome = dispatcher.notify('diskBudget', { usedPercent: 82 });

    expect(outcome.logged).toBe(true);
    expect(outcome.mailed).toBe(false);
    expect(logged[0].message).toContain('usedPercent=82');
    expect(mailed).toHaveLength(0);
  });

  test('senza mailer si logga lo stesso', () => {
    const { dispatcher, logged } = makeDispatcher({ getMailer: () => null });
    expect(dispatcher.notify('diskBudget', {}).mailed).toBe(false);
    expect(logged).toHaveLength(1);
  });

  test('un canary scattato è loggato come errore, il disco come avviso', () => {
    // Chi legge il log alle tre di notte deve distinguere senza leggere il testo.
    const { dispatcher, logged } = makeDispatcher();
    dispatcher.notify('canaryTriggered', {});
    dispatcher.notify('diskBudget', {});

    expect(logged[0].level).toBe('error');
    expect(logged[1].level).toBe('warn');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('fail-soft', () => {
  test('un mailer che lancia non propaga', () => {
    // Chi chiama sta servendo una richiesta: un errore SMTP non deve diventare
    // un 500 per chi sta navigando.
    const { dispatcher, logged } = makeDispatcher({
      getMailer: () => ({ send: () => { throw new Error('SMTP giù'); } }),
    });

    expect(() => dispatcher.notify('canaryTriggered', {})).not.toThrow();
    expect(logged.some((l) => l.message.includes('SMTP giù'))).toBe(true);
  });

  test('una promise rifiutata non diventa un unhandled rejection', async () => {
    const { dispatcher, logged } = makeDispatcher({
      getMailer: () => ({ send: () => Promise.reject(new Error('coda piena')) }),
    });

    dispatcher.notify('canaryTriggered', {});
    await new Promise((resolve) => setImmediate(resolve));
    expect(logged.some((l) => l.message.includes('coda piena'))).toBe(true);
  });

  test('un destinatario che cambia a caldo viene riletto ad ogni allerta', () => {
    // `alertRecipient` si può modificare e ricaricare senza riavviare: leggerlo
    // una volta alla costruzione significherebbe spedire all'indirizzo vecchio.
    let recipient = null;
    const mailed = [];
    const dispatcher = new AlertDispatcher({
      log: () => {},
      getRecipient: () => recipient,
      getMailer: () => ({ send: (msg) => { mailed.push(msg); } }),
    });

    dispatcher.notify('diskBudget', {});
    expect(mailed).toHaveLength(0);

    recipient = 'ops@esempio.test';
    dispatcher.windows.get('diskBudget').lastSentAt = Date.now() - 61 * 60000;
    dispatcher.notify('diskBudget', {});
    expect(mailed).toHaveLength(1);
  });
});
