/**
 * Unit test di keyResolver — estrazione dell'identificatore client (IP) dal ctx.
 */

'use strict';

const { resolveClientId } = require('../../lib/keyResolver');

describe('keyResolver — trustProxy disabilitato (default)', () => {
  test('usa ctx.ip', () => {
    const ctx = { ip: '203.0.113.5', headers: {} };
    expect(resolveClientId(ctx)).toBe('203.0.113.5');
    expect(resolveClientId(ctx, { trustProxy: false })).toBe('203.0.113.5');
  });

  test('ignora X-Forwarded-For quando trustProxy è false', () => {
    const ctx = { ip: '203.0.113.5', headers: { 'x-forwarded-for': '9.9.9.9' } };
    expect(resolveClientId(ctx, { trustProxy: false })).toBe('203.0.113.5');
  });

  test('fallback a ctx.request.ip se ctx.ip assente', () => {
    const ctx = { request: { ip: '198.51.100.2' }, headers: {} };
    expect(resolveClientId(ctx)).toBe('198.51.100.2');
  });

  test("fallback a 'unknown' se nessun IP disponibile", () => {
    expect(resolveClientId({ headers: {} })).toBe('unknown');
    expect(resolveClientId({})).toBe('unknown');
  });
});

describe('keyResolver — trustProxy abilitato', () => {
  test('legge il primo IP di X-Forwarded-For', () => {
    const ctx = { ip: '10.0.0.1', headers: { 'x-forwarded-for': '203.0.113.9' } };
    expect(resolveClientId(ctx, { trustProxy: true })).toBe('203.0.113.9');
  });

  test('con catena di proxy prende il client originale (primo)', () => {
    const ctx = { ip: '10.0.0.1', headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1, 172.16.0.1' } };
    expect(resolveClientId(ctx, { trustProxy: true })).toBe('203.0.113.9');
  });

  test('fa trim degli spazi', () => {
    const ctx = { ip: '10.0.0.1', headers: { 'x-forwarded-for': '  203.0.113.9  , 10.0.0.1' } };
    expect(resolveClientId(ctx, { trustProxy: true })).toBe('203.0.113.9');
  });

  test('header assente → fallback a ctx.ip', () => {
    const ctx = { ip: '10.0.0.1', headers: {} };
    expect(resolveClientId(ctx, { trustProxy: true })).toBe('10.0.0.1');
  });

  test('header vuoto → fallback a ctx.ip', () => {
    const ctx = { ip: '10.0.0.1', headers: { 'x-forwarded-for': '' } };
    expect(resolveClientId(ctx, { trustProxy: true })).toBe('10.0.0.1');
  });
});
