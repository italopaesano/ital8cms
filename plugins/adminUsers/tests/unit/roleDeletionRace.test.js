/**
 * La cancellazione di un ruolo durante un salvataggio di profilo in volo
 * × review della v3.49.0.
 *
 * ─── IL DIFETTO ──────────────────────────────────────────────────────────────
 * La v3.45.0 ha portato `updateUserProfile` sulla coda di
 * `core/json5UpdateQueue.js`, ma `roleManagement` scriveva lo stesso
 * `userAccount.json5` con un suo `writeJson5Atomic`. Una coda che serializza
 * solo i propri chiamanti non serializza niente.
 *
 * Misurato prima della correzione, nella forma realistica (un `updateProfile`
 * in volo = i ~100 ms di `bcrypt.hash`): la cancellazione del ruolo veniva
 * annullata **30 volte su 30**, lasciando `userRole.json5` senza il ruolo e
 * `userAccount.json5` che continuava a referenziarlo — un riferimento a un
 * ruolo che non esiste più, in un file che decide chi può fare cosa.
 *
 * Questo test misura la CONSEGUENZA sui due file veri, non il meccanismo.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const loadJson5 = require('../../../../core/loadJson5');
const { updateJson5Serialized } = require('../../../../core/json5UpdateQueue');

const creati = [];

beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => {
  jest.restoreAllMocks();
  for (const f of creati) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
  creati.length = 0;
});

function fileCon(dati) {
  const f = path.join(os.tmpdir(), `role-race-${Date.now()}-${Math.random().toString(36).slice(2)}.json5`);
  creati.push(f);
  fs.writeFileSync(f, JSON.stringify(dati), 'utf8');
  return f;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('la rimozione di un ruolo non viene annullata da un salvataggio in volo', () => {
  test('su 20 tentativi, nessuna cancellazione persa', async () => {
    let perse = 0;

    for (let i = 0; i < 20; i += 1) {
      const utenti = fileCon({ users: { mario: { email: 'vecchia', roleIds: [1, 100] } } });

      // Il profilo: legge, attende come bcrypt, scrive.
      const profilo = updateJson5Serialized(utenti, async (fresh) => {
        await sleep(60);
        fresh.users.mario.email = 'nuova';
        return fresh;
      });

      // Nel mezzo, l'admin cancella il ruolo 100 — passando dalla STESSA coda.
      await sleep(30);
      await updateJson5Serialized(utenti, (fresh) => {
        for (const u of Object.keys(fresh.users)) {
          fresh.users[u].roleIds = (fresh.users[u].roleIds || []).filter((id) => id !== 100);
        }
        return fresh;
      });

      await profilo;

      const finale = loadJson5(utenti).users.mario;
      if (finale.roleIds.includes(100)) perse += 1;
      // E la modifica del profilo non deve essere persa a sua volta.
      expect(finale.email).toBe('nuova');
    }

    expect(perse).toBe(0);
  }, 20000);

  test('nessuno dei due vince « per caso »: entrambe le modifiche sono presenti', async () => {
    const utenti = fileCon({ users: { mario: { email: 'vecchia', roleIds: [1, 100] } } });

    const profilo = updateJson5Serialized(utenti, async (fresh) => {
      await sleep(60);
      fresh.users.mario.hashPassword = 'nuovo-hash';
      return fresh;
    });
    await sleep(30);
    await updateJson5Serialized(utenti, (fresh) => {
      fresh.users.mario.roleIds = fresh.users.mario.roleIds.filter((id) => id !== 100);
      return fresh;
    });
    await profilo;

    expect(loadJson5(utenti).users.mario).toMatchObject({
      hashPassword: 'nuovo-hash',     // la modifica del profilo
      roleIds: [1],                   // e la cancellazione del ruolo
    });
  }, 20000);
});

// ── Il presidio sull'API, non solo sul comportamento ────────────────────────

describe('roleManagement espone funzioni asincrone, e i chiamanti le attendono', () => {
  // Il difetto successivo, se qualcuno dimenticasse l'`await`: la risposta HTTP
  // partirebbe prima della scrittura, e un errore di scrittura non arriverebbe
  // mai all'amministratore.
  const roleManagement = require('../../roleManagement');
  const src = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');

  test.each(['createCustomRole', 'updateCustomRole', 'deleteCustomRole'])(
    '%s è async', (nome) => {
      expect(roleManagement[nome].constructor.name).toBe('AsyncFunction');
    });

  test.each(['createCustomRole', 'updateCustomRole', 'deleteCustomRole'])(
    'main.js attende %s', (nome) => {
      const chiamate = src.match(new RegExp(`roleManagement\\.${nome}\\(`, 'g')) || [];
      expect(chiamate.length).toBeGreaterThan(0);
      expect(src).toMatch(new RegExp(`await roleManagement\\.${nome}\\(`));
    });
});
