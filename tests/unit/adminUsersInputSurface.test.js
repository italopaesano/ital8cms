/**
 * Unit test: la superficie pubblica di adminUsers × REVIEW.md → C1 e B4.
 *
 *   C1 — `GET /logged` stampava `JSON.stringify(ctx.session)`, cioè TUTTA la
 *        sessione, incluso il `csrfToken` che csrfProtection custodisce lì
 *        proprio perché non sia leggibile. In entrambi i rami, non solo in
 *        quello autenticato come riportava la scheda.
 *   B4 — la validazione dello username ACCETTAVA `__proto__`: assegnarlo
 *        sostituisce il prototipo dell'oggetto invece di creare una proprietà,
 *        `JSON.stringify` non lo serializza, e la funzione rispondeva
 *        « creato con successo » senza aver creato nulla.
 */

'use strict';

const { getRouteArray } = require('../../plugins/adminUsers/main');
const { userUsert } = require('../../plugins/adminUsers/userManagement');

/** L'handler della rotta cercata, preso dall'array vero. */
function handlerDi(method, routePath) {
  const route = getRouteArray().find((r) => r.method === method && r.path === routePath);
  expect(route).toBeDefined();
  return route.handler;
}

function fakeCtx(session) {
  return { session, body: undefined, type: undefined, status: 200 };
}

// ── C1 ───────────────────────────────────────────────────────────────────────

describe('C1 — GET /logged non stampa più la sessione', () => {
  const CSRF = 'token-csrf-che-non-deve-uscire';

  test('anonimo: solo `authenticated: false`', async () => {
    const ctx = fakeCtx({ csrfToken: CSRF });
    await handlerDi('GET', '/logged')(ctx);

    expect(ctx.body).toEqual({ authenticated: false });
    expect(JSON.stringify(ctx.body)).not.toContain(CSRF);
  });

  test('autenticato: solo il flag e lo username', async () => {
    const ctx = fakeCtx({
      authenticated: true,
      csrfToken: CSRF,
      user: { username: 'mario', email: 'm@x', roleIds: [1] },
    });

    await handlerDi('GET', '/logged')(ctx);

    expect(ctx.body).toEqual({ authenticated: true, username: 'mario' });
    // Né il token, né l'email, né i ruoli: nulla che non sia stato chiesto.
    const uscita = JSON.stringify(ctx.body);
    expect(uscita).not.toContain(CSRF);
    expect(uscita).not.toContain('m@x');
    expect(uscita).not.toContain('roleIds');
  });

  test('risponde JSON, non testo con `[object Object]` dentro', async () => {
    // Che fosse un endpoint di debug rimasto acceso lo diceva il codice stesso:
    // `${ctx.session.user}` produceva la stringa `[object Object]`.
    const ctx = fakeCtx({ authenticated: true, user: { username: 'mario' } });
    await handlerDi('GET', '/logged')(ctx);

    expect(ctx.type).toBe('json');
    expect(JSON.stringify(ctx.body)).not.toContain('[object Object]');
  });

  test('una sessione con `user` ma senza il flag è trattata come anonima', () => {
    // Coerenza con C5: la rotta usa la definizione condivisa.
    const ctx = fakeCtx({ user: { username: 'mario' }, csrfToken: CSRF });
    return handlerDi('GET', '/logged')(ctx).then(() => {
      expect(ctx.body).toEqual({ authenticated: false });
    });
  });
});

// ── B4 ───────────────────────────────────────────────────────────────────────

describe('B4 — gli username riservati del linguaggio sono rifiutati', () => {
  // Il rifiuto avviene PRIMA di qualunque lettura o scrittura di file, quindi
  // questi test non toccano `userAccount.json5`.
  test.each(['__proto__', 'constructor', 'prototype'])(
    '"%s" è rifiutato con un messaggio che dice perché',
    async (username) => {
      const esito = await userUsert(username, 'Password1!', 'x@y.z', [2]);

      expect(esito.error).toMatch(/nome riservato/i);
      expect(esito.errorType).toBe('username');
      expect(esito.success).toBeUndefined();
    });

  test('il rifiuto arriva prima della validazione di forma, non dopo', async () => {
    // `__proto__` passa la regex `/^[A-Za-z0-9_\-]+$/` — sono solo lettere e
    // underscore — quindi senza la denylist esplicita il controllo di forma lo
    // avrebbe accettato e il problema sarebbe emerso molto più a valle.
    const esito = await userUsert('__proto__', 'Password1!', 'x@y.z', [2]);

    expect(esito.error).not.toMatch(/caratteri|formato/i);
    expect(esito.error).toMatch(/riservato/i);
  });
});
