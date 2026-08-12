/**
 * insertRuleText.js — inserimento testuale di una regola in sentinelRules.json5
 *
 * Condiviso dagli step di migrazione di questo plugin.
 *
 * ─── PERCHE NON `setJson5Key(path, 'rules', nuovoArray)` ──────────────────────
 * Perché riscriverebbe l'INTERO array `rules` a partire da una serializzazione
 * dell'oggetto, e in `sentinelRules.json5` dentro quell'array ci sono le cornici
 * di sezione e la descrizione di cosa osserva ogni regola: metà del valore del
 * file. Una migrazione che aggiunge una riga e cancella ottanta commenti è un
 * danno più grande del problema che risolve.
 *
 * Quindi si lavora sul TESTO, con la stessa cautela di `lib/rulesFileEditor.js`:
 * si parsa prima, si parsa dopo, e si pretende che la differenza sia esattamente
 * quella attesa. Se non lo è, non si scrive niente.
 *
 * ─── PERCHE UNA COPIA E NON UN `require` DI `lib/rulesFileEditor.js` ──────────
 * Uno script di migrazione gira su installazioni **vecchie** e deve continuare a
 * funzionare identico fra due anni. Se dipendesse dal codice corrente del
 * plugin, una futura rifattorizzazione di quel codice cambierebbe il
 * comportamento di una migrazione già scritta e collaudata — o la romperebbe. Le
 * migrazioni sono congelate nel tempo, e per esserlo devono essere autonome.
 * Questa duplicazione è deliberata.
 *
 * ─── DOVE VIENE INSERITA LA REGOLA ────────────────────────────────────────────
 * Subito dopo il blocco iniziale di regole `allow`, cioè in testa alla sezione
 * delle rilevazioni. Non in fondo: con first-match-wins una regola accodata
 * arriverebbe dopo `backup-probe`, che matcha `.tar.gz` — e un canary consegnato
 * dentro un finto `backup-....tar.gz` non arriverebbe mai alla propria regola.
 * La posizione è la stessa che ha nel file distribuito.
 */

'use strict';

const fs = require('fs');
const JSON5 = require('json5');

/**
 * Conta le graffe di una porzione di testo ignorando quelle dentro stringhe e
 * commenti di riga: nelle descrizioni delle regole le parentesi ci sono davvero.
 */
function braceDelta(text) {
  let delta = 0;
  let inString = null;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    if (ch === '{') delta++;
    else if (ch === '}') delta--;
  }
  return delta;
}

/**
 * Quante regole saltare prima di inserire.
 *
 * Di base il blocco iniziale di `allow` (la whitelist, che con first-match-wins
 * deve restare sovrana). Con `afterRule` si va invece subito dopo una regola
 * nominata: serve a mantenere fra le regole nuove lo stesso ordine che hanno nel
 * file distribuito, quando uno step ne aggiunge una che deve stare sotto quella
 * aggiunta dallo step precedente.
 */
function resolveSkip(rules, afterRule) {
  let skip = 0;
  while (skip < rules.length && rules[skip].action === 'allow') skip++;

  if (afterRule) {
    const at = rules.findIndex((r) => r && r.name === afterRule);
    if (at !== -1 && at + 1 > skip) skip = at + 1;
  }
  return skip;
}

/**
 * Individua l'offset in cui inserire, cioè l'inizio della riga che apre la
 * regola davanti alla quale va messa quella nuova.
 *
 * @returns {number|null}
 */
function findInsertionOffset(text, rules, afterRule) {
  const rulesAt = text.indexOf('rules:');
  if (rulesAt === -1) return null;
  const arrayAt = text.indexOf('[', rulesAt);
  if (arrayAt === -1) return null;

  const skip = resolveSkip(rules, afterRule);

  // Cammina gli oggetti di primo livello dentro l'array.
  let depth = 0;
  let index = 0;
  let objectStart = -1;

  for (let i = arrayAt + 1; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) {
        if (index === skip) {
          // Inizio dell'oggetto cercato: si risale all'inizio della sua riga.
          const lineStart = text.lastIndexOf('\n', i) + 1;
          return lineStart;
        }
        objectStart = i;
      }
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0 && objectStart !== -1) {
        index++;
        objectStart = -1;
      }
      continue;
    }
    if (ch === ']' && depth === 0) break;
  }

  return null;
}

/**
 * Inserisce una regola nel file, se non c'è già.
 *
 * @param {string} filePath - sentinelRules.json5 VIVO
 * @param {string} ruleText - testo JSON5 della regola, indentato di 4 spazi,
 *                            terminato da virgola e riga vuota
 * @param {string} ruleName - nome della regola, per l'idempotenza e la verifica
 * @param {object} [options]
 * @param {boolean} [options.dryRun]
 * @param {string} [options.afterRule] - nome della regola dopo cui inserire
 * @returns {{ applied: boolean, reason: string, index?: number }}
 */
function insertRule(filePath, ruleText, ruleName, options = {}) {
  if (!fs.existsSync(filePath)) {
    return { applied: false, reason: 'file assente' };
  }

  const before = fs.readFileSync(filePath, 'utf8');
  let parsedBefore;
  try {
    parsedBefore = JSON5.parse(before);
  } catch (err) {
    throw new Error(`sentinelRules.json5 non è JSON5 valido (${err.message}): migrazione annullata`);
  }

  const rules = Array.isArray(parsedBefore.rules) ? parsedBefore.rules : [];
  if (rules.some((r) => r && r.name === ruleName)) {
    return { applied: false, reason: 'già presente' };
  }

  const offset = findInsertionOffset(before, rules, options.afterRule);
  if (offset === null) {
    throw new Error('punto di inserimento non individuato in sentinelRules.json5: migrazione annullata');
  }

  const after = before.slice(0, offset) + ruleText + before.slice(offset);

  // ── Verifica differenziale ──
  // Un'espressione regolare che colpisce la riga sbagliata produce un file che
  // *sembra* giusto. Si pretende che la differenza sia esattamente una regola in
  // più, con il nome atteso, nella posizione attesa, e tutte le altre intatte
  // e nello stesso ordine.
  let parsedAfter;
  try {
    parsedAfter = JSON5.parse(after);
  } catch (err) {
    throw new Error(`l'inserimento avrebbe prodotto JSON5 non valido (${err.message}): scrittura annullata`);
  }

  const nomiPrima = rules.map((r) => r && r.name);
  const nomiDopo = (parsedAfter.rules || []).map((r) => r && r.name);
  const atteso = nomiPrima.filter((n) => n !== null);
  const skip = resolveSkip(rules, options.afterRule);
  atteso.splice(skip, 0, ruleName);

  if (nomiDopo.length !== nomiPrima.length + 1 || nomiDopo.join('|') !== atteso.join('|')) {
    throw new Error(
      `l'inserimento avrebbe alterato l'ordine delle regole (atteso ${atteso.join(', ')}, `
      + `ottenuto ${nomiDopo.join(', ')}): scrittura annullata`
    );
  }
  if (braceDelta(after) !== 0) {
    throw new Error('graffe sbilanciate dopo l\'inserimento: scrittura annullata');
  }

  if (options.dryRun) {
    return { applied: false, reason: 'dry-run', index: skip };
  }

  // Scrittura atomica: temp + rename, come tutte le scritture del progetto.
  const temp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temp, after, 'utf8');
  fs.renameSync(temp, filePath);

  return { applied: true, reason: 'inserita', index: skip };
}

module.exports = { insertRule, findInsertionOffset, resolveSkip, braceDelta };
