const fs = require('fs');
const os = require('os');
const path = require('path');
const { readEnableAdmin, writeEnableAdmin } = require('../../../core/cliBridge/configEditor');

function tmpConfigPath() {
  return path.join(os.tmpdir(), `ital8cms-cfgEditor-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json5`);
}

function write(p, content) { fs.writeFileSync(p, content, 'utf8'); }
function read(p) { return fs.readFileSync(p, 'utf8'); }

describe('readEnableAdmin', () => {
  test('reads true', () => {
    const p = tmpConfigPath();
    write(p, '{\n  "enableAdmin": true,\n  "httpPort": 3000,\n}\n');
    try { expect(readEnableAdmin(p)).toBe(true); }
    finally { fs.unlinkSync(p); }
  });

  test('reads false', () => {
    const p = tmpConfigPath();
    write(p, '{\n  "enableAdmin": false,\n  "httpPort": 3000,\n}\n');
    try { expect(readEnableAdmin(p)).toBe(false); }
    finally { fs.unlinkSync(p); }
  });

  test('throws when enableAdmin is missing', () => {
    const p = tmpConfigPath();
    write(p, '{\n  "httpPort": 3000,\n}\n');
    try {
      expect(() => readEnableAdmin(p)).toThrow(/non trovato/);
    } finally { fs.unlinkSync(p); }
  });
});

describe('writeEnableAdmin', () => {
  test('flips true → false preserving surrounding content', () => {
    const p = tmpConfigPath();
    const before =
`{
  // commento iniziale
  "enableAdmin": true,
  "httpPort": 3000,
  "https": {
    "enabled": true,
  },
}
`;
    write(p, before);
    try {
      const result = writeEnableAdmin(p, false);
      expect(result.changed).toBe(true);
      expect(result.previous).toBe(true);
      expect(result.current).toBe(false);
      const after = read(p);
      expect(after).toContain('"enableAdmin": false,');
      expect(after).toContain('// commento iniziale');
      expect(after).toContain('"httpPort": 3000,');
      expect(after).toContain('"enabled": true,');
    } finally { fs.unlinkSync(p); }
  });

  test('flips false → true', () => {
    const p = tmpConfigPath();
    write(p, '{\n  "enableAdmin": false,\n}\n');
    try {
      writeEnableAdmin(p, true);
      expect(read(p)).toContain('"enableAdmin": true,');
    } finally { fs.unlinkSync(p); }
  });

  test('preserves trailing comment on the same line', () => {
    const p = tmpConfigPath();
    write(p, '{\n  "enableAdmin": true, // attivo\n}\n');
    try {
      writeEnableAdmin(p, false);
      const after = read(p);
      expect(after).toContain('"enableAdmin": false,');
      expect(after).toContain('// attivo');
    } finally { fs.unlinkSync(p); }
  });

  test('idempotent when value is already correct', () => {
    const p = tmpConfigPath();
    write(p, '{\n  "enableAdmin": true,\n}\n');
    const original = read(p);
    try {
      const result = writeEnableAdmin(p, true);
      expect(result.changed).toBe(false);
      expect(read(p)).toBe(original);
    } finally { fs.unlinkSync(p); }
  });

  test('does not match enableAdmin inside a comment', () => {
    const p = tmpConfigPath();
    write(p, '{\n  // "enableAdmin": foo se vuoi disabilitare l\'area\n  "enableAdmin": true,\n}\n');
    try {
      writeEnableAdmin(p, false);
      const after = read(p);
      expect(after).toContain('// "enableAdmin": foo');
      expect(after).toContain('"enableAdmin": false,');
    } finally { fs.unlinkSync(p); }
  });

  test('throws TypeError for non-boolean value', () => {
    const p = tmpConfigPath();
    write(p, '{ "enableAdmin": true }');
    try {
      expect(() => writeEnableAdmin(p, 'true')).toThrow(TypeError);
      expect(() => writeEnableAdmin(p, 1)).toThrow(TypeError);
    } finally { fs.unlinkSync(p); }
  });

  test('throws when enableAdmin is missing', () => {
    const p = tmpConfigPath();
    write(p, '{ "httpPort": 3000 }');
    try {
      expect(() => writeEnableAdmin(p, false)).toThrow(/non trovato/);
    } finally { fs.unlinkSync(p); }
  });
});
