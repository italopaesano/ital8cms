/**
 * Unit test: una sola definizione di « autenticato » × REVIEW.md → C5.
 *
 * Il difetto: due punti decidevano la stessa cosa con criteri diversi.
 *
 *   core/pluginSys.js (route-wrap)         → `!ctx.session || !ctx.session.authenticated`
 *   adminAccessControl (middleware pagine) → `ctx.session?.user || null`
 *
 * Uno guardava il **flag**, l'altro l'**oggetto**. Coincidevano perché il login
 * imposta entrambi i campi insieme — una coincidenza mantenuta a mano. Bastava
 * che un giorno `session.user` venisse impostato senza `authenticated` (per
 * ricordare l'ultimo username in un form, o durante un flusso a due fattori)
 * perché il controllo delle PAGINE considerasse autenticato qualcuno che il
 * controllo delle ROTTE rifiuta.
 *
 * La definizione pretende ora **entrambi** i campi, ed è la più stretta delle
 * due: è il senso della correzione.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { isAuthenticated, sessionUser } = require('../../../core/isAuthenticated');

const ctxCon = (session) => ({ session });

describe('isAuthenticated — pretende entrambi i campi', () => {
  test('flag + utente → autenticato', () => {
    expect(isAuthenticated(ctxCon({ authenticated: true, user: { username: 'mario' } }))).toBe(true);
  });

  test('utente SENZA flag → NON autenticato (la divergenza di C5)', () => {
    expect(isAuthenticated(ctxCon({ user: { username: 'mario' } }))).toBe(false);
  });

  test('flag SENZA utente → NON autenticato', () => {
    // Un flag senza l'oggetto non permette di decidere alcun ruolo: dire « sì »
    // qui significherebbe far passare qualcuno di cui non si sa nulla.
    expect(isAuthenticated(ctxCon({ authenticated: true }))).toBe(false);
  });

  test.each([
    [{ authenticated: 'true', user: { username: 'm' } }, 'flag come stringa'],
    [{ authenticated: 1, user: { username: 'm' } }, 'flag come numero'],
    [{}, 'sessione vuota'],
    [null, 'sessione nulla'],
    [undefined, 'sessione assente'],
  ])('%#: %s → NON autenticato', (session) => {
    expect(isAuthenticated(ctxCon(session))).toBe(false);
  });

  test('un ctx assente non fa esplodere il predicato', () => {
    expect(isAuthenticated(undefined)).toBe(false);
    expect(isAuthenticated(null)).toBe(false);
  });
});

describe('sessionUser — restituisce l\'utente SOLO se autenticato', () => {
  test('autenticato → l\'oggetto utente', () => {
    const user = { username: 'mario', roleIds: [1] };
    expect(sessionUser(ctxCon({ authenticated: true, user }))).toBe(user);
  });

  test('utente senza flag → null, non l\'oggetto', () => {
    // È la forma `ctx.session?.user || null` che restituiva l'oggetto comunque.
    expect(sessionUser(ctxCon({ user: { username: 'mario' } }))).toBeNull();
  });

  test('sessione vuota o assente → null', () => {
    expect(sessionUser(ctxCon({}))).toBeNull();
    expect(sessionUser(ctxCon(null))).toBeNull();
  });
});

// ── Presidio strutturale: i due punti usano DAVVERO la funzione condivisa ────

describe('i due punti di decisione sono allineati', () => {
  // Senza questo, nulla impedisce che uno dei due torni a decidere da sé — e
  // sarebbe di nuovo C5, con la stessa invisibilità.
  const leggi = (rel) => fs.readFileSync(path.join(__dirname, '../../..', rel), 'utf8');

  test('core/pluginSys.js importa e usa il predicato', () => {
    const src = leggi('core/pluginSys.js');
    expect(src).toMatch(/require\(['"]\.\/isAuthenticated['"]\)/);
    expect(src).toMatch(/isAuthenticated\(ctx\)/);
  });

  test('adminAccessControl importa e usa sessionUser', () => {
    const src = leggi('plugins/adminAccessControl/lib/accessManager.js');
    expect(src).toMatch(/require\(['"]\.\.\/\.\.\/\.\.\/core\/isAuthenticated['"]\)/);
    expect(src).toMatch(/sessionUser\(ctx\)/);
  });

  test('nessuno dei due guarda più `session.user` da sé', () => {
    // La forma incriminata: `ctx.session?.user || null`.
    for (const rel of ['core/pluginSys.js', 'plugins/adminAccessControl/lib/accessManager.js']) {
      expect(leggi(rel)).not.toMatch(/ctx\.session\?\.user \|\| null/);
    }
  });
});
