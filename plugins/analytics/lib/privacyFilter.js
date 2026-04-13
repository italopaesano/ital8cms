/**
 * privacyFilter.js
 *
 * Anonimizzazione dati personali per conformità GDPR.
 *
 * IP ANONYMIZATION:
 *   IPv4 → mantiene i primi 2 ottetti (area geografica ISP):
 *          "151.38.123.45" → "151.38"
 *   IPv6 → mantiene i primi 2 gruppi + "::" (area geografica ISP):
 *          "2001:0db8:85a3::8a2e:0370:7334" → "2001:0db8::"
 *
 * SESSION HASHING:
 *   Hasha con HMAC-SHA256 il cookie di sessione Koa già presente.
 *   Nessun cookie extra viene aggiunto → nessun cookie banner richiesto.
 *
 * NOTA GDPR — useAnalyticsCookie: true:
 *   Se abilitato, imposta un cookie analytics dedicato per il tracking
 *   cross-sessione. Questo rientra nella categoria dei cookie di tracciamento
 *   ai sensi del GDPR (Reg. UE 2016/679) e della Direttiva ePrivacy.
 *   Il titolare del sito È RESPONSABILE di implementare un cookie banner
 *   con consenso esplicito prima di attivare questa opzione.
 */

const crypto = require('crypto');

/**
 * Anonimizza un indirizzo IPv4 mantenendo solo i primi 2 ottetti.
 *
 * @param {string} ip - Indirizzo IPv4 (es. "151.38.123.45")
 * @returns {string} IP anonimizzato (es. "151.38"), o "unknown" se non valido
 */
function anonymizeIPv4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return 'unknown';
  return `${parts[0]}.${parts[1]}`;
}

/**
 * Anonimizza un indirizzo IPv6 mantenendo solo i primi 2 gruppi.
 * Gestisce anche gli indirizzi IPv4-mapped (::ffff:x.x.x.x).
 *
 * @param {string} ip - Indirizzo IPv6 (es. "2001:0db8:85a3::8a2e:0370:7334")
 * @returns {string} IP anonimizzato (es. "2001:0db8::"), o "unknown" se non valido
 */
function anonymizeIPv6(ip) {
  // Gestisci indirizzi IPv4-mapped IPv6 (es. "::ffff:192.168.1.1")
  if (ip.startsWith('::ffff:') || ip.startsWith('::FFFF:')) {
    const ipv4Part = ip.slice(7);
    return anonymizeIPv4(ipv4Part);
  }

  // Espandi la notazione abbreviata per estrarre i primi 2 gruppi
  const parts = ip.split(':');
  if (parts.length < 2) return 'unknown';

  // Prendi i primi due gruppi significativi (ignorando eventuali '::')
  const nonEmpty = parts.filter(p => p !== '');
  const g0 = nonEmpty[0] || '0';
  const g1 = nonEmpty[1] || '0';

  return `${g0}:${g1}::`;
}

/**
 * Anonimizza un indirizzo IP (IPv4 o IPv6) per conformità GDPR.
 * Rimuove le parti identificative mantenendo solo l'area geografica di rete.
 *
 * @param {string|undefined} ip - Indirizzo IP grezzo dalla richiesta
 * @returns {string} IP anonimizzato, o "unknown" se non disponibile/valido
 */
function anonymizeIp(ip) {
  if (!ip || typeof ip !== 'string') return 'unknown';
  const cleanIp = ip.trim();
  if (!cleanIp) return 'unknown';

  // Determina il tipo di indirizzo dalla presenza del separatore IPv6
  if (cleanIp.includes(':')) {
    return anonymizeIPv6(cleanIp);
  }
  return anonymizeIPv4(cleanIp);
}

/**
 * Calcola HMAC-SHA256 di un valore con il salt configurato.
 *
 * @param {string} value - Valore da hashare
 * @param {string} salt  - Salt segreto (da cambiare in produzione!)
 * @returns {string} Hash esadecimale (64 caratteri)
 */
function hashWithSalt(value, salt) {
  return crypto.createHmac('sha256', salt).update(value).digest('hex');
}

/**
 * Recupera e hasha il session ID dalla richiesta Koa.
 *
 * Modalità default (useAnalyticsCookie: false):
 *   Usa il cookie di sessione Koa già esistente ('koa:sess').
 *   Nessun cookie extra → nessun cookie banner necessario.
 *
 * Modalità cookie analytics (useAnalyticsCookie: true):
 *   Usa un cookie analytics dedicato per tracking cross-sessione.
 *   ⚠ RICHIEDE COOKIE BANNER (vedi nota GDPR in testa al file).
 *
 * @param {object} ctx              - Contesto Koa
 * @param {string} cookieName       - Nome del cookie da leggere
 * @param {string} salt             - Salt per HMAC (da config.sessionSalt)
 * @returns {string|null} Hash della sessione, o null se cookie non presente
 */
function getHashedSessionId(ctx, cookieName, salt) {
  try {
    const rawCookie = ctx.cookies.get(cookieName);
    if (!rawCookie) return null;
    return hashWithSalt(rawCookie, salt);
  } catch (e) {
    return null;
  }
}

module.exports = { anonymizeIp, getHashedSessionId, hashWithSalt };
