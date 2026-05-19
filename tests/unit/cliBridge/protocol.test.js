const { parseRequestLine, parseSocketMode } = require('../../../core/cliBridge/server');
const { makeDispatcher, STUB_ACTIONS } = require('../../../core/cliBridge/handlers');

describe('parseRequestLine', () => {
  test('accepts a valid status request', () => {
    const r = parseRequestLine('{"command":"status"}');
    expect(r.ok).toBe(true);
    expect(r.value.command).toBe('status');
  });

  test('rejects invalid JSON', () => {
    const r = parseRequestLine('not json at all');
    expect(r).toMatchObject({ ok: false, error: 'invalid_json' });
  });

  test('rejects null literal', () => {
    const r = parseRequestLine('null');
    expect(r).toMatchObject({ ok: false, error: 'invalid_request' });
  });

  test('rejects array', () => {
    const r = parseRequestLine('[1,2,3]');
    expect(r).toMatchObject({ ok: false, error: 'invalid_request' });
  });

  test('rejects object without command', () => {
    const r = parseRequestLine('{"foo":"bar"}');
    expect(r).toMatchObject({ ok: false, error: 'invalid_request' });
  });

  test('rejects object with non-string command', () => {
    const r = parseRequestLine('{"command":42}');
    expect(r).toMatchObject({ ok: false, error: 'invalid_request' });
  });

  test('rejects object with empty command', () => {
    const r = parseRequestLine('{"command":""}');
    expect(r).toMatchObject({ ok: false, error: 'invalid_request' });
  });
});

describe('parseSocketMode', () => {
  test('uses fallback for undefined', () => {
    expect(parseSocketMode(undefined, 0o660)).toBe(0o660);
  });
  test('uses fallback for null', () => {
    expect(parseSocketMode(null, 0o644)).toBe(0o644);
  });
  test('uses fallback for empty string', () => {
    expect(parseSocketMode('', 0o600)).toBe(0o600);
  });
  test('passes through finite numbers', () => {
    expect(parseSocketMode(0o600, 0o660)).toBe(0o600);
  });
  test('parses "0660"', () => {
    expect(parseSocketMode('0660', 0)).toBe(0o660);
  });
  test('parses "660"', () => {
    expect(parseSocketMode('660', 0)).toBe(0o660);
  });
  test('parses "0o660"', () => {
    expect(parseSocketMode('0o660', 0)).toBe(0o660);
  });
  test('uses fallback for non-numeric garbage', () => {
    expect(parseSocketMode('zzz', 0o644)).toBe(0o644);
  });
});

describe('makeDispatcher', () => {
  const ital8Conf = {
    httpPort: 3000,
    https: { enabled: true, port: 3443 },
  };
  const startTime = Date.now() - 5000;

  test('status returns ok with pid, uptime, ports', () => {
    const dispatch = makeDispatcher({ startTime, ital8Conf });
    const res = dispatch('status');
    expect(res.ok).toBe(true);
    expect(res.data.pid).toBe(process.pid);
    expect(res.data.uptime).toBeGreaterThanOrEqual(4);
    expect(res.data.httpPort).toBe(3000);
    expect(res.data.httpsEnabled).toBe(true);
    expect(res.data.httpsPort).toBe(3443);
    expect(res.data.admin).toEqual({ state: 'unknown' });
    expect(res.data.public).toEqual({ state: 'unknown' });
  });

  test('status reports httpsEnabled=false when https block disabled', () => {
    const dispatch = makeDispatcher({
      startTime,
      ital8Conf: { httpPort: 8080, https: { enabled: false, port: 443 } },
    });
    const res = dispatch('status');
    expect(res.data.httpsEnabled).toBe(false);
    expect(res.data.httpsPort).toBeNull();
  });

  test.each(STUB_ACTIONS)('stub command %s returns stub:true', (action) => {
    const dispatch = makeDispatcher({ startTime, ital8Conf });
    const res = dispatch(action);
    expect(res).toEqual({
      ok: true,
      stub: true,
      action,
      message: expect.stringContaining('stub'),
    });
  });

  test('unknown command returns ok:false with unknown_command error', () => {
    const dispatch = makeDispatcher({ startTime, ital8Conf });
    const res = dispatch('nonsense');
    expect(res).toMatchObject({ ok: false, error: 'unknown_command' });
    expect(res.message).toContain('nonsense');
  });
});
