/**
 * Unit test: i permessi del socket di controllo × REVIEW.md → C6.
 *
 * Il difetto era in due parti. (1) Il `chmod` stava DENTRO la callback di
 * `listen`, cioè dopo che il socket esisteva: fra la creazione e la chiusura
 * dei permessi c'era una finestra in cui il canale di controllo era
 * raggiungibile con i permessi di default (`0777 & ~umask`). (2) Un `chmod`
 * fallito era solo un **warning**: il canale restava aperto con permessi
 * **ignoti**, che è peggio di un canale assente.
 *
 * Il primo test è quello che conta: misura il modo del socket e pretende che sia
 * già quello configurato — cioè che la finestra non esista, non che venga
 * chiusa in fretta.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const cliBridge = require('../../../core/cliBridge/server');

const avviati = [];
const creati = [];

function confCon(socketMode) {
  const socketPath = path.join(os.tmpdir(), `c6-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
  creati.push(socketPath);
  return { socketPath, ital8Conf: { cli: { enabled: true, socketPath, socketMode } } };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  jest.restoreAllMocks();
  for (const handle of avviati) {
    await new Promise((r) => handle.server.close(r));
  }
  avviati.length = 0;
  for (const p of creati) { try { fs.unlinkSync(p); } catch (_) {} }
  creati.length = 0;
});

describe('il socket nasce già con i permessi giusti', () => {
  test.each(['0600', '0660'])('modo %s: misurato sul file, non dedotto', async (modo) => {
    const { socketPath, ital8Conf } = confCon(modo);

    const handle = await cliBridge.start(ital8Conf, { projectRoot: os.tmpdir() });
    expect(handle).not.toBeNull();
    avviati.push(handle);

    const atteso = parseInt(modo, 8);
    expect(fs.statSync(socketPath).mode & 0o777).toBe(atteso);
  });

  test('la umask del processo viene ripristinata, non lasciata alterata', async () => {
    // È globale al processo: lasciarla stretta cambierebbe il modo di ogni file
    // creato dopo, in tutta l'applicazione.
    const prima = process.umask();
    const { ital8Conf } = confCon('0600');

    const handle = await cliBridge.start(ital8Conf, { projectRoot: os.tmpdir() });
    avviati.push(handle);

    expect(process.umask()).toBe(prima);
  });
});

describe('se i permessi non si possono garantire, il canale NON si apre', () => {
  test('chmod che fallisce → nessun canale, e il socket non resta in giro', async () => {
    const { socketPath, ital8Conf } = confCon('0600');
    jest.spyOn(fs, 'chmodSync').mockImplementation(() => { throw new Error('EPERM simulato'); });

    const handle = await cliBridge.start(ital8Conf, { projectRoot: os.tmpdir() });

    expect(handle).toBeNull();                      // prima era un warning e il canale restava
    expect(fs.existsSync(socketPath)).toBe(false);  // e il file non resta a confondere
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('NON aperto'));
  });

  test('modo diverso da quello chiesto → nessun canale (la garanzia è quella MISURATA)', async () => {
    // Il chmod non lancia ma non ottiene il modo richiesto: stesso trattamento.
    const { ital8Conf } = confCon('0600');
    jest.spyOn(fs, 'chmodSync').mockImplementation(() => {});   // finge successo
    const statVero = fs.statSync;
    jest.spyOn(fs, 'statSync').mockImplementation((p) => {
      const st = statVero(p);
      return { ...st, mode: (st.mode & ~0o777) | 0o666 };       // modo sbagliato
    });

    const handle = await cliBridge.start(ital8Conf, { projectRoot: os.tmpdir() });

    expect(handle).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('invece di'));
  });
});
