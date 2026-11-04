/**
 * Migrazione rateLimiter v1 → v2
 *
 * Porta `custom.enforcement.exemptPaths` dai letterali ai segnaposti di percorso.
 *
 * ─── PERCHE SERVE UNO SCRIPT ──────────────────────────────────────────────────
 * Il merge additivo del boot sa solo AGGIUNGERE chiavi. Qui le chiavi sono le
 * stesse e cambiano i VALORI dentro un array — e gli array il merge li tratta
 * come valori opachi, giustamente: fonderli significherebbe indovinare l'ordine
 * e sovrascrivere scelte dell'amministratore.
 *
 * ─── PERCHE CONTA, QUI PIU CHE ALTROVE ────────────────────────────────────────
 * `exemptPaths` esiste per non auto-bloccare l'amministratore sul pannello. Un
 * letterale `/admin/**` smette di combaciare appena `adminPrefix` cambia, e la
 * conseguenza non è « una regola che non protegge » ma « l'amministratore si fa
 * limitare sul proprio pannello », cioè perde lo strumento con cui correggerebbe.
 *
 * ─── BASATA SU OGGETTO, NON SU TESTO ──────────────────────────────────────────
 * `setJson5Key` con path annidato scrive la sola chiave e preserva i commenti del
 * file vivo. È la differenza con la migrazione v3→v4 di adminAccessControl, che
 * doveva rinominare CHIAVI e quindi lavorare sul testo: lì la chirurgia testuale
 * era inevitabile, qui no — e dove si puo evitarla, si evita.
 *
 * ─── E I COMMENTI DENTRO L'ARRAY? ─────────────────────────────────────────────
 * Sopravvivono anche loro, da v3.33.0. Fino alla v3.32.0 no: `setJson5Key`
 * delegava a `editJson5`, che sostituiva il BLOCCO dell'array e con esso ogni
 * commento interno — quindi un amministratore che aveva annotato una propria
 * esenzione la perdeva, e questa intestazione affermava il contrario.
 *
 * Ora `editJson5` ricorre PER INDICE quando la lunghezza dell'array non cambia,
 * e qui non cambia mai: lo script usa `declared.map(...)`, che per costruzione
 * restituisce un array della stessa lunghezza. Quindi l'affermazione è vera
 * senza riserve per questa migrazione — non perché il caso difficile non esista,
 * ma perché questa migrazione non lo produce.
 *
 * ─── SOSTITUISCE SOLO I LETTERALI DISTRIBUITI ─────────────────────────────────
 * Un elemento viene convertito solo se è ESATTAMENTE uno dei tre spediti col
 * plugin. Tutto il resto — percorsi aggiunti, modificati, riordinati — resta dov'è
 * e come è: l'ordine è preservato, e ciò che non è stato convertito viene detto.
 * Idempotente: i segnaposti non sono fra i letterali da convertire.
 */

'use strict';

const path = require('path');

/** Letterale distribuito → segnaposto. Solo questi, e solo se identici. */
const SHIPPED = Object.freeze(new Map([
  ['/admin/**', '{{admin}}/**'],
  ['/public-theme-resources/**', '{{publicThemeResources}}/**'],
  ['/admin-theme-resources/**', '{{adminThemeResources}}/**'],
]));

const KEY_PATH = ['custom', 'enforcement', 'exemptPaths'];

async function migrate(ctx) {
  const { packageDir, loadJson5, setJson5Key, logger, dryRun } = ctx;
  const livePath = path.join(packageDir, 'pluginConfig.json5');

  const live = loadJson5(livePath);
  const declared = live && live.custom && live.custom.enforcement
    && live.custom.enforcement.exemptPaths;

  if (!Array.isArray(declared)) {
    logger.info('migrate', 'rateLimiter: custom.enforcement.exemptPaths assente, nulla da convertire');
    return;
  }

  const converted = [];
  const untouched = [];
  const next = declared.map((entry) => {
    if (typeof entry !== 'string') { untouched.push(String(entry)); return entry; }
    const placeholder = SHIPPED.get(entry);
    if (placeholder === undefined) {
      // Già un segnaposto, o un percorso dell'amministratore: non si tocca.
      if (!entry.includes('{{')) untouched.push(entry);
      return entry;
    }
    converted.push(`${entry} → ${placeholder}`);
    return placeholder;
  });

  if (untouched.length > 0) {
    logger.warn('migrate',
      `rateLimiter: questi exemptPaths restano LETTERALI perche non sono fra quelli `
      + `distribuiti (percorsi tuoi, o modificati): ${untouched.join(', ')}. `
      + 'Funzionano, ma non seguiranno un prefisso non di default: conviene '
      + 'convertirli a mano se puntano a una zona del CMS.');
  }

  if (converted.length === 0) {
    logger.info('migrate', 'rateLimiter: exemptPaths già convertiti, nessuna modifica');
    return;
  }

  if (dryRun) {
    logger.info('migrate', `rateLimiter [dry-run]: ${converted.length} exemptPaths da convertire (${converted.join(' · ')})`);
    return;
  }

  await setJson5Key(livePath, KEY_PATH, next);
  logger.info('migrate', `rateLimiter: ${converted.length} exemptPaths convertiti ai segnaposti (${converted.join(' · ')})`);
}

module.exports = migrate;
module.exports.migrate = migrate;
