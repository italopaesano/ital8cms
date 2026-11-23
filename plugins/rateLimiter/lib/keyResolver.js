/**
 * keyResolver.js
 *
 * Estrae un identificatore stabile del client (tipicamente l'IP) dal contesto Koa.
 * Questo identificatore è la prima metà della chiave di rate limit (IP + ruleName).
 *
 * IMPORTANTE (sicurezza): l'header X-Forwarded-For è falsificabile dal client.
 * Va usato SOLO quando ital8cms è dietro un reverse proxy fidato che lo imposta
 * (es. nginx). Per questo la lettura dell'header è dietro il flag `trustProxy`.
 */

'use strict';


const net = require('net');

/**
 * Riduce un indirizzo IPv6 al suo prefisso /64 (i primi 64 bit).
 *
 * ─── PERCHÉ (REVIEW.md → C2) ─────────────────────────────────────────────────
 * Su IPv4 usare l'indirizzo intero come chiave ha senso: un indirizzo costa. Su
 * IPv6 no — l'assegnazione minima a un utente domestico è una /64, cioè
 * 18 miliardi di miliardi di indirizzi. Cambiare indirizzo a ogni tentativo è
 * banale e ogni tentativo riparte da un contatore a zero: la difesa anti
 * brute-force **non rallentava nulla** su IPv6.
 *
 * Normalizzando alla /64 l'intera assegnazione condivide un contatore, che è la
 * pratica standard.
 *
 * ─── IL PREZZO, DICHIARATO ───────────────────────────────────────────────────
 * Utenti **legittimi diversi** dietro la stessa /64 condividono il contatore: in
 * una rete domestica è lo stesso abbonato, ma in uno studio o in un campus
 * possono essere persone diverse. È il compromesso che rende la difesa efficace
 * su IPv6; chi ha bisogno della granularità per indirizzo deve mettere davanti
 * un proxy che distingua gli utenti in altro modo.
 *
 * ─── I CASI LIMITE, GESTITI ──────────────────────────────────────────────────
 *  - **IPv4** → restituito invariato: l'indirizzo intero è la chiave giusta.
 *  - **IPv4-mapped** (`::ffff:1.2.3.4`) → è un IPv4, e viene trattato come tale.
 *    Troncarlo metterebbe nello stesso contatore TUTTI gli IPv4 mappati
 *    del mondo, cioè trasformerebbe la difesa in un blocco globale.
 *  - **zone id** (`fe80::1%eth0`) → la zona è locale alla macchina, non
 *    identifica il client: si scarta.
 *  - valori non riconosciuti (`'unknown'`, un header falsificato) → invariati.
 *
 * @param {string} ip
 * @returns {string} Il prefisso `a:b:c:d::/64`, o l'input invariato
 */
function normalizeIpForKey(ip) {
  if (typeof ip !== 'string' || ip === '') return ip;

  // La zona (`%eth0`) è un dettaglio dell'host, non del client.
  const senzaZona = ip.split('%')[0];

  if (!net.isIPv6(senzaZona)) return ip;

  // `::ffff:1.2.3.4` è un IPv4: va trattato come IPv4, non troncato.
  const mapped = senzaZona.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return mapped[1];

  // Espande la forma compressa in 8 gruppi, poi tiene i primi 4 (= /64).
  const [testa, coda = ''] = senzaZona.split('::');
  const gruppiTesta = testa ? testa.split(':').filter(Boolean) : [];
  const gruppiCoda = coda ? coda.split(':').filter(Boolean) : [];
  const mancanti = 8 - gruppiTesta.length - gruppiCoda.length;

  const gruppi = senzaZona.includes('::')
    ? [...gruppiTesta, ...Array(Math.max(0, mancanti)).fill('0'), ...gruppiCoda]
    : senzaZona.split(':');

  if (gruppi.length !== 8) return ip;   // forma che non so espandere: non invento

  const prefisso = gruppi.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':');
  return `${prefisso}::/64`;
}

/**
 * Restituisce l'identificatore del client a partire dal contesto Koa.
 *
 * @param {object} ctx - Contesto Koa
 * @param {object} [options]
 * @param {boolean} [options.trustProxy=false] - Se true, legge X-Forwarded-For
 * @returns {string} - IP del client (o 'unknown' se non determinabile)
 */
function resolveClientId(ctx, options = {}) {
  const trustProxy = options.trustProxy === true;

  if (trustProxy && ctx && ctx.headers) {
    const xff = ctx.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      // X-Forwarded-For: "client, proxy1, proxy2" → il primo è il client originale
      const first = xff.split(',')[0].trim();
      if (first) {
        return normalizeIpForKey(first);
      }
    }
  }

  // Fallback: IP della socket. ctx.ip dipende da app.proxy in Koa; se non
  // impostato restituisce l'indirizzo remoto reale della connessione.
  const ip = (ctx && (ctx.ip || (ctx.request && ctx.request.ip))) || '';
  return normalizeIpForKey(ip || 'unknown');
}

module.exports = { resolveClientId,
  normalizeIpForKey,
};
