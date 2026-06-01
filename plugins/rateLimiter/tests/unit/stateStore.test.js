/**
 * Unit test di stateStore — persistenza dello stato attivo (snapshot atomico).
 * Usa una directory temporanea e ripulisce SEMPRE timer e handler di segnale.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const StateStore = require('../../lib/stateStore');
const loadJson5 = require('../../../../core/loadJson5');

let tmpDir;
const stores = []; // per cleanup di timer/handler

function makeFakeEngine(serialized = {}) {
  return {
    dirty: false,
    _serialized: serialized,
    loadedWith: undefined,
    serialize() { return this._serialized; },
    load(obj) { this.loadedWith = obj; },
  };
}

function newStore(engine, config) {
  const ss = new StateStore(tmpDir, engine, config);
  stores.push(ss);
  return ss;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-rl-state-'));
});

afterEach(() => {
  // Rimuove timer e handler SIGTERM/SIGINT per evitare leak tra i test
  while (stores.length) {
    try { stores.pop().shutdown(); } catch (e) { /* noop */ }
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('stateStore — init', () => {
  test('senza file esistente crea state/ e activeBlocks.json5 vuoto', () => {
    const engine = makeFakeEngine();
    const ss = newStore(engine, { flushIntervalSeconds: 0 });
    ss.init();

    const file = path.join(tmpDir, 'state', 'activeBlocks.json5');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('{}');
    expect(engine.dirty).toBe(false);
  });

  test('carica uno stato esistente nello engine (load round-trip)', () => {
    const stateDir = path.join(tmpDir, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    const entry = { clientId: '1.2.3.4', ruleName: 'adminLogin', tier: 'short', blockedUntil: 9999999999999 };
    const content =
      '// This file follows the JSON5 standard - comments and trailing commas are supported\n' +
      JSON.stringify({ '1.2.3.4|adminLogin': entry }, null, 2) + '\n';
    fs.writeFileSync(path.join(stateDir, 'activeBlocks.json5'), content);

    const engine = makeFakeEngine();
    const ss = newStore(engine, { flushIntervalSeconds: 0 });
    ss.init();

    expect(engine.loadedWith).toBeDefined();
    expect(engine.loadedWith['1.2.3.4|adminLogin'].tier).toBe('short');
    expect(engine.dirty).toBe(false);
  });
});

describe('stateStore — flush', () => {
  test('scrive lo stato (atomico) quando dirty, e azzera dirty', () => {
    const engine = makeFakeEngine();
    const ss = newStore(engine, { flushIntervalSeconds: 0 });
    ss.init();

    engine._serialized = {
      '203.0.113.5|adminLogin': { clientId: '203.0.113.5', ruleName: 'adminLogin', tier: 'long', blockedUntil: 9999999999999 },
    };
    engine.dirty = true;
    ss.flush();

    const file = path.join(tmpDir, 'state', 'activeBlocks.json5');
    const data = loadJson5(file);
    expect(data['203.0.113.5|adminLogin'].tier).toBe('long');
    expect(engine.dirty).toBe(false);
  });

  test('non riscrive il file quando non dirty', () => {
    const engine = makeFakeEngine();
    const ss = newStore(engine, { flushIntervalSeconds: 0 });
    ss.init();

    const file = path.join(tmpDir, 'state', 'activeBlocks.json5');
    fs.writeFileSync(file, 'SENTINELLA');
    engine.dirty = false;
    engine._serialized = { foo: { clientId: 'x' } };
    ss.flush();

    expect(fs.readFileSync(file, 'utf8')).toBe('SENTINELLA');
  });
});

describe('stateStore — timer e handler', () => {
  test('flushIntervalSeconds 0 → nessun timer', () => {
    const ss = newStore(makeFakeEngine(), { flushIntervalSeconds: 0 });
    ss.init();
    expect(ss.flushTimer).toBeNull();
  });

  test('flushIntervalSeconds > 0 → timer creato e rimosso da shutdown', () => {
    const ss = newStore(makeFakeEngine(), { flushIntervalSeconds: 30 });
    ss.init();
    expect(ss.flushTimer).not.toBeNull();
    ss.shutdown();
    expect(ss.flushTimer).toBeNull();
  });

  test('init registra handler SIGTERM/SIGINT, shutdown li rimuove', () => {
    const termBefore = process.listenerCount('SIGTERM');
    const intBefore = process.listenerCount('SIGINT');

    const ss = new StateStore(tmpDir, makeFakeEngine(), { flushIntervalSeconds: 0 });
    ss.init();
    expect(process.listenerCount('SIGTERM')).toBe(termBefore + 1);
    expect(process.listenerCount('SIGINT')).toBe(intBefore + 1);

    ss.shutdown();
    expect(process.listenerCount('SIGTERM')).toBe(termBefore);
    expect(process.listenerCount('SIGINT')).toBe(intBefore);
  });
});
