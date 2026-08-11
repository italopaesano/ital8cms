'use strict';

/**
 * requestGuard.js — Cuore della validazione CSRF (logica pura, testabile).
 *
 * `evaluate(ctx, custom, matcher, access)` decide se una richiesta deve passare o
 * essere bloccata, in base alla policy:
 *   1. metodi non mutanti / plugin disabilitato / path esente → pass
 *   2. token sincronizzatore SEMPRE richiesto per i metodi mutanti
 *   3. Origin/Referer come secondo layer (token-fallback se entrambi assenti)
 *
 * Nessuno stato di modulo: tutto arriva dai parametri → facile da testare.
 */

const { safeEqual } = require('./tokenManager');
const { validateOrigin } = require('./originValidator');

const DEFAULT_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH'];

/** Ambiti CSRF possibili, dal più interno al più esterno. */
const SCOPES = ['authenticated', 'authEntryPoint', 'public'];

/**
 * Ambito CSRF di una rotta, DERIVATO dalle dichiarazioni che la rotta fa già.
 *
 * Non esiste un marcatore CSRF da apporre: `access` è obbligatorio su ogni rotta
 * (la sua assenza è un errore fatale al boot) e i suoi due campi descrivono già
 * il perimetro, perché sono gli stessi da cui la superficie riservata deriva il
 * proprio — vedi core/priorityMiddlewares/runtimeGate.js.
 *
 *   requiresAuth: true      → 'authenticated'   sta dietro l'autenticazione
 *   isAuthEntryPoint: true  → 'authEntryPoint'  varco pubblico per necessità
 *                                               (login, logout): è QUI che vive
 *                                               il CSRF anonimo che conta
 *   nessuno dei due         → 'public'          rotta dichiaratamente pubblica
 *
 * Il vantaggio è lo stesso della superficie riservata: una rotta nuova eredita
 * il comportamento senza dichiarare nulla, e non c'è alcun elenco di percorsi da
 * tenere allineato a mano.
 *
 * @param {object} [access] - il blocco `access` della rotta
 * @returns {'authenticated'|'authEntryPoint'|'public'|null} null se il chiamante
 *   non ha dichiarato l'ambito (es. un test che invoca evaluate direttamente)
 */
function scopeOf(access) {
  if (!access || typeof access !== 'object') return null;
  if (access.requiresAuth === true) return 'authenticated';
  if (access.isAuthEntryPoint === true) return 'authEntryPoint';
  return 'public';
}

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
 * @param {object} [access] - blocco `access` della rotta (per l'ambito derivato)
 * @returns {{ ok: boolean, status?: number, error?: string, reason?: string, skipped?: string, scope?: string }}
 */
function evaluate(ctx, custom, matcher, access) {
  // L'ambito accompagna OGNI verdetto, anche quelli positivi: serve all'audit
  // per distinguere un blocco su un varco di autenticazione (qualcuno bussa al
  // login senza token: scanner, o client mal configurato) da un blocco su una
  // rotta pubblica (che è invece quasi sempre una pagina rotta da riparare).
  const scope = scopeOf(access);
  const tag = (verdict) => (scope ? Object.assign(verdict, { scope }) : verdict);

  if (!custom || custom.enabled === false) return tag({ ok: true, skipped: 'disabled' });

  if (!isMutatingMethod(ctx.method, custom.protectedMethods)) {
    return tag({ ok: true, skipped: 'non-mutating' });
  }

  if (isExempt(ctx.path, custom.exemptPaths, matcher)) {
    return tag({ ok: true, skipped: 'exempt' });
  }

  // ── POLICY DI AMBITO: tutti e tre gli ambiti sono protetti allo stesso modo ──
  //
  // È la scelta "sicura per default", e nel codice reale non costa nulla: sulle
  // 56 rotte mutanti del progetto 51 sono `authenticated`, 2 sono i varchi
  // login/logout, e le uniche 3 `public` stanno in `exampleComplete`. Proteggere
  // l'ambito pubblico è quindi oggi un no-op che copre però il caso futuro — un
  // plugin nuovo con un form pubblico è protetto senza che il suo autore debba
  // saperlo, invece di nascere scoperto in silenzio.
  //
  // Se un giorno si volesse rilassare l'ambito pubblico, il punto è esattamente
  // questo, una riga:
  //     if (scope === 'public') return tag({ ok: true, skipped: 'public-scope' });
  // e andrebbe accoppiata all'inversione del ramo `mode: 'none'` più sotto: senza
  // token da usare come ripiego, "né Origin né Referer" deve diventare un
  // RIFIUTO, non un lasciapassare.

  const status = custom.failureStatus || 403;

  // 1) Token sincronizzatore — SEMPRE richiesto per i metodi mutanti.
  const sessionToken = ctx.session && ctx.session.csrfToken;
  const provided = tokenFromRequest(
    ctx,
    custom.tokenHeaderName || 'X-CSRF-Token',
    custom.tokenFieldName || '_csrf',
  );
  if (!sessionToken || !provided || !safeEqual(provided, String(sessionToken))) {
    return tag({ ok: false, status, error: 'CSRF validation failed', reason: 'missing_or_invalid_token' });
  }

  // 2) Origin/Referer — secondo layer. Token-fallback se entrambi assenti.
  if (custom.originCheck && custom.originCheck.enabled !== false) {
    const verdict = validateOrigin(ctx, {
      trustProxy: custom.trustProxy === true,
      allowedOrigins: custom.originCheck.allowedOrigins || [],
    });
    if (verdict.mode !== 'none' && verdict.ok === false) {
      return tag({
        ok: false,
        status,
        error: 'CSRF validation failed',
        reason: `origin_mismatch:${verdict.mode}`,
      });
    }
  }

  return tag({ ok: true });
}

module.exports = {
  evaluate,
  scopeOf,
  isMutatingMethod,
  isExempt,
  tokenFromRequest,
  normalizeMethod,
  DEFAULT_METHODS,
  SCOPES,
};
