/**
 * ipMatcher.js
 *
 * Confronto di indirizzi IP contro notazioni CIDR, IPv4 e IPv6.
 *
 * PERCHE SCRITTO A MANO — il progetto ha una politica di zero dipendenze npm nel
 * core e nei plugin di base. Il confronto CIDR è algoritmo puro su bit: nessuna
 * ragione di portarsi dietro un pacchetto.
 *
 * IL PUNTO CHE ROMPE LE IMPLEMENTAZIONI INGENUE — `ctx.ip` in Node può
 * restituire un indirizzo IPv4 in forma "IPv4-mapped IPv6": `::ffff:151.38.1.1`
 * invece di `151.38.1.1`. Succede quando il server ascolta su dual-stack, cioè
 * nella configurazione di default. Un matcher che non normalizza fallisce il
 * confronto con `151.38.0.0/16` e lascia passare (o blocca) esattamente chi non
 * doveva: una allowlist che non funziona è peggio di una allowlist assente.
 */

'use strict';

/**
 * Riporta un indirizzo alla sua forma canonica per il confronto.
 * Toglie il prefisso IPv4-mapped e lo zone index (`%eth0`) degli IPv6 link-local.
 *
 * @param {string} ip
 * @returns {string}
 */
function normalizeIp(ip) {
  if (typeof ip !== 'string') return '';
  let out = ip.trim();
  if (out === '') return '';

  // Zone index: fe80::1%eth0 → fe80::1
  const zoneAt = out.indexOf('%');
  if (zoneAt !== -1) out = out.slice(0, zoneAt);

  // IPv4-mapped: ::ffff:151.38.1.1 → 151.38.1.1 (anche in maiuscolo)
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(out);
  if (mapped) return mapped[1];

  // Loopback IPv6 verso IPv4 NON viene convertito: ::1 e 127.0.0.1 sono
  // indirizzi distinti e una regola che nomina l'uno non deve catturare l'altro.
  return out;
}

/** @returns {boolean} true se la stringa è un IPv4 valido in notazione decimale. */
function isIpv4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * Converte un IPv4 nei suoi 4 byte.
 * @returns {number[]|null}
 */
function ipv4ToBytes(ip) {
  if (!isIpv4(ip)) return null;
  return ip.split('.').map(Number);
}

/**
 * Converte un IPv6 nei suoi 16 byte, espandendo la forma abbreviata `::`.
 * Accetta anche la forma mista con coda IPv4 (`::ffff:1.2.3.4`), benché la
 * normalizzazione la intercetti prima.
 *
 * @returns {number[]|null} 16 byte, o null se malformato
 */
function ipv6ToBytes(ip) {
  if (ip.indexOf(':') === -1) return null;

  let head = ip;
  let tailBytes = [];

  // Coda IPv4 embedded: la si converte e la si tratta come gli ultimi 4 byte.
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (tail.indexOf('.') !== -1) {
    const v4 = ipv4ToBytes(tail);
    if (!v4) return null;
    tailBytes = v4;
    head = ip.slice(0, lastColon + 1) + '0:0';
  }

  const doubleColonCount = (head.match(/::/g) || []).length;
  if (doubleColonCount > 1) return null;

  let groups;
  if (doubleColonCount === 1) {
    const [left, right] = head.split('::');
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const missing = 8 - (leftGroups.length + rightGroups.length);
    if (missing < 0) return null;
    groups = [...leftGroups, ...new Array(missing).fill('0'), ...rightGroups];
  } else {
    groups = head.split(':');
  }

  if (groups.length !== 8) return null;

  const bytes = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    const value = parseInt(g, 16);
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }

  // Se c'era una coda IPv4, sostituisce gli ultimi 4 byte con quelli reali.
  if (tailBytes.length === 4) {
    bytes.splice(12, 4, ...tailBytes);
  }

  return bytes;
}

/**
 * Converte un indirizzo (già normalizzato) nei suoi byte, con la famiglia.
 * @returns {{ bytes: number[], family: 4|6 }|null}
 */
function toBytes(ip) {
  const v4 = ipv4ToBytes(ip);
  if (v4) return { bytes: v4, family: 4 };
  const v6 = ipv6ToBytes(ip);
  if (v6) return { bytes: v6, family: 6 };
  return null;
}

/**
 * Analizza una notazione CIDR o un indirizzo singolo.
 * Un indirizzo senza `/` equivale al prefisso pieno (/32 o /128).
 *
 * @param {string} cidr - es. "10.0.0.0/8", "2001:db8::/32", "203.0.113.44"
 * @returns {{ bytes: number[], family: 4|6, prefixLength: number }|null}
 */
function parseCidr(cidr) {
  if (typeof cidr !== 'string' || cidr.trim() === '') return null;

  const [rawAddress, rawPrefix] = cidr.trim().split('/');
  const parsed = toBytes(normalizeIp(rawAddress));
  if (!parsed) return null;

  const maxPrefix = parsed.family === 4 ? 32 : 128;
  let prefixLength = maxPrefix;

  if (rawPrefix !== undefined) {
    if (!/^\d{1,3}$/.test(rawPrefix)) return null;
    prefixLength = Number(rawPrefix);
    if (prefixLength > maxPrefix) return null;
  }

  return { bytes: parsed.bytes, family: parsed.family, prefixLength };
}

/**
 * Verifica se un indirizzo ricade in una rete CIDR.
 *
 * Famiglie diverse non matchano mai: un IPv6 non appartiene a una rete IPv4,
 * nemmeno se "equivalente". Gli IPv4-mapped sono già stati riportati a IPv4
 * dalla normalizzazione, quindi il caso pratico è coperto.
 *
 * @param {string} ip   - Indirizzo del client (anche in forma IPv4-mapped)
 * @param {string} cidr - Rete o indirizzo singolo
 * @returns {boolean}
 */
function ipInCidr(ip, cidr) {
  const net = parseCidr(cidr);
  if (!net) return false;

  const addr = toBytes(normalizeIp(ip));
  if (!addr) return false;
  if (addr.family !== net.family) return false;

  const fullBytes = Math.floor(net.prefixLength / 8);
  const remainingBits = net.prefixLength % 8;

  for (let i = 0; i < fullBytes; i++) {
    if (addr.bytes[i] !== net.bytes[i]) return false;
  }

  if (remainingBits === 0) return true;

  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (addr.bytes[fullBytes] & mask) === (net.bytes[fullBytes] & mask);
}

/**
 * Verifica se un indirizzo ricade in almeno una delle reti indicate.
 *
 * @param {string} ip
 * @param {string[]} cidrList
 * @returns {boolean}
 */
function ipMatchesAny(ip, cidrList) {
  if (!Array.isArray(cidrList) || cidrList.length === 0) return false;
  for (const cidr of cidrList) {
    if (ipInCidr(ip, cidr)) return true;
  }
  return false;
}

/**
 * Valida una notazione CIDR (usata dal validatore delle regole al caricamento).
 * @returns {boolean}
 */
function isValidCidr(cidr) {
  return parseCidr(cidr) !== null;
}

module.exports = {
  normalizeIp,
  ipInCidr,
  ipMatchesAny,
  isValidCidr,
  parseCidr,
};
