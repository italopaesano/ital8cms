/**
 * Migrazione seo v1 → v2
 *
 * Porta `custom.robotsTxtRules.disallow` dai letterali ai segnaposti di percorso.
 *
 * ─── PERCHE SERVE UNO SCRIPT ──────────────────────────────────────────────────
 * Stesse ragioni della gemella in rateLimiter: le chiavi non cambiano, cambiano i
 * VALORI dentro un array, e il merge additivo tratta gli array come valori opachi.
 *
 * ─── ROBOTS.TXT VIVE IN UN ALTRO SPAZIO DI PATH, E CONTA ──────────────────────
 * Gli altri consumatori di segnaposti CONFRONTANO un percorso con la richiesta in
 * arrivo, dopo aver tolto il `globalPrefix`. Qui i percorsi vengono EMESSI in un
 * file che i crawler leggono sul sito reale, quindi il `globalPrefix` va
 * ANTEPOSTO. Lo fa il generatore da v3.30.0 (`lib/robotsTxtGenerator.js` →
 * `toServedPaths`), e prima non lo faceva affatto: `Disallow: /admin/` su
 * un'istanza montata sotto `/mysite` non escludeva niente. Questa migrazione
 * sposta i valori; la correzione del globalPrefix sta nel codice e arriva da sé.
 *
 * ─── SOSTITUISCE SOLO I LETTERALI DISTRIBUITI ─────────────────────────────────
 * Come la gemella: solo gli elementi ESATTAMENTE uguali a quelli spediti, ordine
 * preservato, il resto dichiarato e lasciato. Idempotente.
 */

'use strict';

const path = require('path');

/** Letterale distribuito → segnaposto. Solo questi, e solo se identici. */
const SHIPPED = Object.freeze(new Map([
  ['/admin/', '{{admin}}/'],
  ['/api/', '{{api}}/'],
  ['/pluginPages/', '{{pluginPages}}/'],
]));

const KEY_PATH = ['custom', 'robotsTxtRules', 'disallow'];

async function migrate(ctx) {
  const { packageDir, loadJson5, setJson5Key, logger, dryRun } = ctx;
  const livePath = path.join(packageDir, 'pluginConfig.json5');

  const live = loadJson5(livePath);
  const declared = live && live.custom && live.custom.robotsTxtRules
    && live.custom.robotsTxtRules.disallow;

  if (!Array.isArray(declared)) {
    logger.info('migrate', 'seo: custom.robotsTxtRules.disallow assente, nulla da convertire');
    return;
  }

  const converted = [];
  const untouched = [];
  const next = declared.map((entry) => {
    if (typeof entry !== 'string') { untouched.push(String(entry)); return entry; }
    const placeholder = SHIPPED.get(entry);
    if (placeholder === undefined) {
      if (!entry.includes('{{')) untouched.push(entry);
      return entry;
    }
    converted.push(`${entry} → ${placeholder}`);
    return placeholder;
  });

  if (untouched.length > 0) {
    logger.warn('migrate',
      'seo: questi disallow restano LETTERALI perche non sono fra quelli distribuiti '
      + `(percorsi tuoi, o modificati): ${untouched.join(', ')}. Restano validi, ma `
      + 'non seguiranno un prefisso non di default: conviene convertirli a mano se '
      + 'puntano a una zona del CMS.');
  }

  if (converted.length === 0) {
    logger.info('migrate', 'seo: disallow già convertiti, nessuna modifica');
    return;
  }

  if (dryRun) {
    logger.info('migrate', `seo [dry-run]: ${converted.length} disallow da convertire (${converted.join(' · ')})`);
    return;
  }

  await setJson5Key(livePath, KEY_PATH, next);
  logger.info('migrate', `seo: ${converted.length} disallow convertiti ai segnaposti (${converted.join(' · ')})`);
}

module.exports = migrate;
module.exports.migrate = migrate;
