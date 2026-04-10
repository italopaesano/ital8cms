'use strict';

/**
 * htmlToText — Converte HTML in testo plain
 *
 * Usato dal mailer per auto-generare la versione testuale delle email
 * quando il chiamante fornisce solo il campo html (senza text).
 *
 * Non è un parser HTML completo — sufficiente per email transazionali
 * con struttura semplice (tag di blocco, link, liste, tabelle).
 *
 * @param {string} html - Stringa HTML
 * @returns {string}    - Testo plain normalizzato
 */
function htmlToText(html) {
  if (!html || typeof html !== 'string') return '';

  return html
    // Rimuove contenuto di <style> e <script> (tag + contenuto)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Tag di blocco → newline
    .replace(/<br\s*\/?>/gi,   '\n')
    .replace(/<\/p>/gi,        '\n\n')
    .replace(/<\/div>/gi,      '\n')
    .replace(/<\/h[1-6]>/gi,   '\n\n')
    .replace(/<\/li>/gi,       '\n')
    .replace(/<\/tr>/gi,       '\n')
    .replace(/<\/td>/gi,       '  ')
    // Rimuove tutti i tag HTML rimanenti
    .replace(/<[^>]+>/g, '')
    // Decode entità HTML comuni
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '--')
    // Normalizza spazi e tab multipli (ma preserva newline)
    .replace(/[ \t]+/g, ' ')
    // Normalizza sequenze di newline (max 2 consecutive)
    .replace(/\n{3,}/g, '\n\n')
    // Trim finale
    .trim();
}

module.exports = htmlToText;
