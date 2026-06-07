'use strict';

/**
 * originValidator.js — Controllo Origin/Referer lato server.
 *
 * Ricostruisce l'origin atteso (scheme://host) dalla richiesta stessa
 * (zero-config, sempre "same-origin"), opzionalmente proxy-aware, e confronta
 * con l'header Origin (o, in fallback, l'origin estratto dal Referer).
 *
 * Perché è affidabile contro il CSRF: nel browser della vittima l'header Origin
 * è impostato dal browser e NON è sovrascrivibile da JavaScript (forbidden
 * header). Un tool che falsifica Origin non ha il cookie di sessione della
 * vittima, quindi non rappresenta un CSRF.
 */

/**
 * Ricostruisce l'origin atteso (scheme://host) dalla richiesta.
 * Con trustProxy legge X-Forwarded-Proto / X-Forwarded-Host (primo valore della catena).
 * @param {object} ctx - Koa context
 * @param {{trustProxy?: boolean}} [opts]
 * @returns {string} es. "https://localhost:3443"
 */
function getExpectedOrigin(ctx, opts = {}) {
  const trustProxy = opts.trustProxy === true;

  let proto = ctx.protocol || 'http';
  let host = ctx.get('host') || ctx.host || '';

  if (trustProxy) {
    const xfProto = ctx.get('x-forwarded-proto');
    if (xfProto) proto = String(xfProto).split(',')[0].trim();
    const xfHost = ctx.get('x-forwarded-host');
    if (xfHost) host = String(xfHost).split(',')[0].trim();
  }

  return `${proto}://${host}`;
}

/**
 * Estrae l'origin (scheme://host[:port]) da una URL completa.
 * @param {string} urlString
 * @returns {string|null} origin oppure null se non parsabile
 */
function originFromUrl(urlString) {
  try {
    return new URL(urlString).origin;
  } catch {
    return null;
  }
}

/**
 * Valida Origin/Referer della richiesta contro l'origin atteso + allowlist.
 *
 * @param {object} ctx - Koa context
 * @param {{trustProxy?: boolean, allowedOrigins?: string[]}} [opts]
 * @returns {{ mode: 'origin'|'referer'|'none', ok: (boolean|null), requestOrigin: (string|null), expected: string }}
 *   - mode 'none' (né Origin né Referer presenti): ok === null → il chiamante
 *     decide la policy (qui: token-fallback).
 */
function validateOrigin(ctx, opts = {}) {
  const expected = getExpectedOrigin(ctx, opts);
  const allow = new Set([expected, ...((opts.allowedOrigins) || [])]);

  const originHeader = ctx.get('origin');
  if (originHeader && originHeader !== 'null') {
    return { mode: 'origin', ok: allow.has(originHeader), requestOrigin: originHeader, expected };
  }

  const referer = ctx.get('referer') || ctx.get('referrer');
  if (referer) {
    const ro = originFromUrl(referer);
    return { mode: 'referer', ok: ro ? allow.has(ro) : false, requestOrigin: ro, expected };
  }

  return { mode: 'none', ok: null, requestOrigin: null, expected };
}

module.exports = { getExpectedOrigin, originFromUrl, validateOrigin };
