'use strict';

/**
 * requestGuard.js — Cuore della validazione CSRF (logica pura, testabile).
 *
 * `evaluate(ctx, custom, matcher)` decide se una richiesta deve passare o essere
 * bloccata, in base alla policy:
 *   1. metodi non mutanti / plugin disabilitato / path esente → pass
 *   2. token sincronizzatore SEMPRE richiesto per i metodi mutanti
 *   3. Origin/Referer come secondo layer (token-fallback se entrambi assenti)
 *
 * Nessuno stato di modulo: tutto arriva dai parametri → facile da testare.
 */

const { safeEqual } = require('./tokenManager');
const { validateOrigin } = require('./originValidator');

const DEFAULT_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH'];

/** Normalizza un metodo HTTP ('DEL' → 'DELETE', case-insensitive). */
function normalizeMethod(method) {
  const up = String(method || '').toUpperCase();
  return up === 'DEL' ? 'DELETE' : up;
}

/** True se il metodo è fra quelli protetti (mutanti). */
function isMutatingMethod(method, protectedMethods) {
  const list = (Array.isArray(protectedMethods) && protectedMethods.length) ? protectedMethods : DEFAULT_METHODS;
  const norm = normalizeMethod(method);
  return list.some((m) => normalizeMethod(m) === norm);
}

/** True se il path è esente (match con uno dei pattern via PatternMatcher). */
function isExempt(ctxPath, exemptPaths, matcher) {
  const list = Array.isArray(exemptPaths) ? exemptPaths : [];
  for (const pattern of list) {
    try {
      if (matcher && matcher.matches(ctxPath, pattern)) return true;
    } catch {
      /* pattern non valido: ignora (la validazione al boot lo segnala) */
    }
  }
  return false;
}

/** Legge il token dalla richiesta: prima dall'header, poi dal campo del body. */
function tokenFromRequest(ctx, headerName, fieldName) {
  const fromHeader = ctx.get(headerName);
  if (fromHeader) return String(fromHeader);
  const body = ctx.request && ctx.request.body;
  if (body && typeof body === 'object' && body[fieldName] != null) {
    return String(body[fieldName]);
  }
  return '';
}

/**
 * Valuta una richiesta secondo la policy CSRF.
 * @param {object} ctx - Koa context
 * @param {object} custom - blocco `custom` di pluginConfig
 * @param {object} matcher - istanza di core/patternMatcher (per exemptPaths)
 * @returns {{ ok: boolean, status?: number, error?: string, reason?: string, skipped?: string }}
 */
function evaluate(ctx, custom, matcher) {
  if (!custom || custom.enabled === false) return { ok: true, skipped: 'disabled' };

  if (!isMutatingMethod(ctx.method, custom.protectedMethods)) {
    return { ok: true, skipped: 'non-mutating' };
  }

  if (isExempt(ctx.path, custom.exemptPaths, matcher)) {
    return { ok: true, skipped: 'exempt' };
  }

  const status = custom.failureStatus || 403;

  // 1) Token sincronizzatore — SEMPRE richiesto per i metodi mutanti.
  const sessionToken = ctx.session && ctx.session.csrfToken;
  const provided = tokenFromRequest(
    ctx,
    custom.tokenHeaderName || 'X-CSRF-Token',
    custom.tokenFieldName || '_csrf',
  );
  if (!sessionToken || !provided || !safeEqual(provided, String(sessionToken))) {
    return { ok: false, status, error: 'CSRF validation failed', reason: 'missing_or_invalid_token' };
  }

  // 2) Origin/Referer — secondo layer. Token-fallback se entrambi assenti.
  if (custom.originCheck && custom.originCheck.enabled !== false) {
    const verdict = validateOrigin(ctx, {
      trustProxy: custom.trustProxy === true,
      allowedOrigins: custom.originCheck.allowedOrigins || [],
    });
    if (verdict.mode !== 'none' && verdict.ok === false) {
      return {
        ok: false,
        status,
        error: 'CSRF validation failed',
        reason: `origin_mismatch:${verdict.mode}`,
      };
    }
  }

  return { ok: true };
}

module.exports = {
  evaluate,
  isMutatingMethod,
  isExempt,
  tokenFromRequest,
  normalizeMethod,
  DEFAULT_METHODS,
};
