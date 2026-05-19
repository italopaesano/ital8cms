const fs = require('fs');
const os = require('os');
const path = require('path');
const { readState, writeState, DEFAULT_STATE } = require('../../../core/cliBridge/stateFile');

function tmpStatePath() {
  return path.join(os.tmpdir(), `ital8cms-state-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json5`);
}

describe('readState', () => {
  test('returns default state when file is missing', () => {
    const p = tmpStatePath();
    expect(fs.existsSync(p)).toBe(false);
    expect(readState(p)).toEqual(DEFAULT_STATE);
  });

  test('reads valid stored state', () => {
    const p = tmpStatePath();
    fs.writeFileSync(p, '// header\n{ "public": "stopped" }\n', 'utf8');
    try { expect(readState(p)).toEqual({ public: 'stopped' }); }
    finally { fs.unlinkSync(p); }
  });

  test('falls back to default when file is invalid JSON', () => {
    const p = tmpStatePath();
    fs.writeFileSync(p, 'this is not json5', 'utf8');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(readState(p)).toEqual(DEFAULT_STATE);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      fs.unlinkSync(p);
    }
  });

  test('normalizes unknown public value to default', () => {
    const p = tmpStatePath();
    fs.writeFileSync(p, '{ "public": "weird" }', 'utf8');
    try { expect(readState(p)).toEqual(DEFAULT_STATE); }
    finally { fs.unlinkSync(p); }
  });
});

describe('writeState', () => {
  test('writes state and is readable back', () => {
    const p = tmpStatePath();
    try {
      writeState({ public: 'stopped' }, p);
      expect(fs.existsSync(p)).toBe(true);
      expect(readState(p)).toEqual({ public: 'stopped' });
    } finally { fs.unlinkSync(p); }
  });

  test('write is atomic (tmp + rename)', () => {
    const p = tmpStatePath();
    try {
      writeState({ public: 'stopped' }, p);
      // no leftover .tmp file
      expect(fs.existsSync(p + '.tmp')).toBe(false);
    } finally { fs.unlinkSync(p); }
  });

  test('writes the do-not-edit-by-hand header', () => {
    const p = tmpStatePath();
    try {
      writeState({ public: 'running' }, p);
      const content = fs.readFileSync(p, 'utf8');
      expect(content).toMatch(/^\/\/.*do not edit by hand/);
    } finally { fs.unlinkSync(p); }
  });

  test('round-trip stopped → running → stopped preserves state', () => {
    const p = tmpStatePath();
    try {
      writeState({ public: 'stopped' }, p);
      expect(readState(p).public).toBe('stopped');
      writeState({ public: 'running' }, p);
      expect(readState(p).public).toBe('running');
      writeState({ public: 'stopped' }, p);
      expect(readState(p).public).toBe('stopped');
    } finally { fs.unlinkSync(p); }
  });
});
