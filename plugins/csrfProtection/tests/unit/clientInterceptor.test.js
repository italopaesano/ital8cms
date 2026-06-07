'use strict';

const { getInterceptorScript } = require('../../lib/clientInterceptor');

describe('csrfProtection · clientInterceptor', () => {
  test('ritorna un blocco <script>…</script>', () => {
    const s = getInterceptorScript();
    expect(s.startsWith('<script>')).toBe(true);
    expect(s.trim().endsWith('</script>')).toBe(true);
  });

  test('patcha sia window.fetch sia XMLHttpRequest', () => {
    const s = getInterceptorScript();
    expect(s).toMatch(/window\.fetch/);
    expect(s).toMatch(/XMLHttpRequest\.prototype\.open/);
    expect(s).toMatch(/XMLHttpRequest\.prototype\.send/);
    expect(s).toMatch(/setRequestHeader/);
  });

  test('limita ai metodi mutanti e alle richieste same-origin', () => {
    const s = getInterceptorScript();
    expect(s).toMatch(/POST\|PUT\|DELETE\|PATCH/);
    expect(s).toMatch(/isSameOrigin/);
  });

  test('usa i nomi di default (meta csrf-token, header X-CSRF-Token)', () => {
    const s = getInterceptorScript();
    expect(s).toContain('"csrf-token"');
    expect(s).toContain('"X-CSRF-Token"');
  });

  test('onora metaName/headerName personalizzati', () => {
    const s = getInterceptorScript({ metaName: 'my-meta', headerName: 'X-My-Csrf' });
    expect(s).toContain('"my-meta"');
    expect(s).toContain('"X-My-Csrf"');
  });

  test('NON incorpora il token (lo legge dal meta a runtime)', () => {
    const s = getInterceptorScript();
    expect(s).toMatch(/querySelector\('meta\[name="'/);
    expect(s).toMatch(/readToken/);
  });
});
