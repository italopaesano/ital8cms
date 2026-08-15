/**
 * rulesFileEditor.js
 *
 * Modifica chirurgica dell'`action` di UNA regola dentro `sentinelRules.json5`,
 * preservando commenti e formattazione.
 *
 * ─── PERCHE NON BASTA setJson5Key ─────────────────────────────────────────────
 * `core/setJson5Key.js` sa scendere in path annidati (`['custom','dataPath']`)
 * ma solo attraverso **oggetti**: il suo locator cerca chiavi. Qui il bersaglio
 * è `rules[i].action`, e `rules` è un array — non c'è una chiave da cercare, c'è
 * un elemento da individuare per contenuto.
 *
 * ─── PERCHE NON SI RISCRIVE IL FILE INTERO ────────────────────────────────────
 * La strada ovvia — `loadJson5`, cambia il campo, `saveJson5` — **perde tutti i
 * commenti**. In `sentinelRules.json5` i commenti non sono decorazione: sono la
 * descrizione di cosa osserva ogni regola, la spiegazione di perché una è
 * disattivata, e le istruzioni per promuoverle. Un salvataggio dalla GUI che
 * silenziosamente cancella metà del file è inaccettabile.
 *
 * ─── COME SI RENDE SICURA UNA MODIFICA TESTUALE ───────────────────────────────
 * Un'edit di testo su un file strutturato è fragile per natura. La rete è la
 * verifica differenziale: si parsa PRIMA, si parsa DOPO, e si pretende che i due
 * oggetti differiscano **esattamente** nel campo bersaglio. Se un'espressione
 * regolare ha colpito la riga sbagliata, il confronto se ne accorge e la
 * scrittura viene annullata prima di toccare il file vero.
 */

'use strict';

const fs = require('fs');
const json5 = require('json5');

/** Azioni ammesse: duplicare qui l'elenco del validatore sarebbe un doppione. */
const { VALID_ACTIONS } = require('./ruleValidator');

/**
 * Individua l'intervallo di righe dell'oggetto-regola che contiene un dato nome.
 *
 * Si parte dalla riga con `name: "<nome>"` e si risale fino alla `{` che apre
 * l'oggetto, poi si scende fino alla `}` che lo chiude, contando le graffe. Il
 * conteggio ignora le graffe dentro stringhe e commenti, che nelle descrizioni
 * ci sono davvero.
 *
 * ─── PERCHE UNA SCANSIONE UNICA IN AVANTI ─────────────────────────────────────
 * Le due scansioni (in su e in giù) usano un profilo delle graffe calcolato UNA
 * volta in avanti, invece di contare riga per riga mentre si spostano. Serve per
 * i commenti a blocco: `/* ... *\/` può attraversare più righe, quindi sapere se
 * una riga è dentro un commento richiede di conoscere quelle PRIMA di lei — cosa
 * che una risalita, per costruzione, non può fare.
 *
 * @param {string[]} lines
 * @param {string} ruleName
 * @returns {{ start: number, end: number }|null}
 */
function findRuleBlock(lines, ruleName) {
  const escaped = ruleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namePattern = new RegExp(`^\\s*["']?name["']?\\s*:\\s*["']${escaped}["']\\s*,?\\s*$`);

  const profile = scanBraces(lines);

  let nameLine = -1;
  for (let i = 0; i < lines.length; i++) {
    // Una regola interamente commentata con /* */ ha righe `name:` dall'aspetto
    // identico a quelle vere: prenderla per buona farebbe riscrivere del testo
    // commentato, cioè la regola sbagliata. (Con `//` non si pone: il commento
    // precede il nome sulla riga e il pattern non attacca.)
    if (profile[i].commented) continue;
    if (namePattern.test(lines[i])) { nameLine = i; break; }
  }
  if (nameLine === -1) return null;

  // Risalita fino alla graffa che apre l'oggetto della regola.
  let start = -1;
  let depth = 0;
  for (let i = nameLine; i >= 0; i--) {
    depth += profile[i].close - profile[i].open;
    if (depth < 0) { start = i; break; }
  }
  if (start === -1) return null;

  // Discesa fino alla sua chiusura.
  let end = -1;
  depth = 0;
  for (let i = start; i < lines.length; i++) {
    depth += profile[i].open - profile[i].close;
    if (depth === 0 && i >= start) { end = i; break; }
  }
  if (end === -1) return null;

  return { start, end };
}

/**
 * Profilo delle graffe di un file, riga per riga, con lo stato dei commenti a
 * blocco portato avanti da una riga all'altra.
 *
 * @param {string[]} lines
 * @returns {Array<{ open: number, close: number, commented: boolean }>}
 *   `commented` = la riga COMINCIA dentro un commento a blocco
 */
function scanBraces(lines) {
  const state = { inBlockComment: false };
  return lines.map((line) => {
    const commented = state.inBlockComment;
    const { open, close } = countBraces(line, state);
    return { open, close, commented };
  });
}

/**
 * Conta le graffe di una riga ignorando stringhe e commenti.
 * Senza questo, una descrizione che contiene `{` sposterebbe il conteggio e la
 * ricerca finirebbe sul blocco sbagliato.
 *
 * Gestisce entrambe le forme di commento. Quella a blocco richiede uno stato che
 * sopravviva alla riga — `/*` su una riga e `*\/` tre righe dopo — e per questo
 * `state` viene MUTATO: chi scandisce un file intero lo passa una volta sola e
 * ottiene il conteggio giusto anche a cavallo delle righe. Chiamandola su una
 * riga isolata lo stato nasce e muore lì, che è il comportamento storico.
 *
 * @param {string} line
 * @param {{ inBlockComment: boolean }} [state] - mutato in place
 * @returns {{ open: number, close: number }}
 */
function countBraces(line, state = { inBlockComment: false }) {
  let open = 0;
  let close = 0;
  let inString = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (state.inBlockComment) {
      if (ch === '*' && line[i + 1] === '/') { state.inBlockComment = false; i++; }
      continue;
    }

    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }

    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === '/' && line[i + 1] === '/') break;          // commento di riga
    if (ch === '/' && line[i + 1] === '*') { state.inBlockComment = true; i++; continue; }
    if (ch === '{') open++;
    else if (ch === '}') close++;
  }

  return { open, close };
}

/**
 * Cambia l'`action` di una regola, preservando il resto del file.
 *
 * @param {string} filePath
 * @param {string} ruleName
 * @param {string} action
 * @returns {{ changed: boolean, previous: string|null }}
 * @throws se la regola non esiste, l'azione non è valida, o la verifica
 *   differenziale rileva un effetto collaterale
 */
function setRuleAction(filePath, ruleName, action) {
  if (!VALID_ACTIONS.includes(action)) {
    throw new Error(`azione non valida: ${action} (ammesse: ${VALID_ACTIONS.join(', ')})`);
  }

  const original = fs.readFileSync(filePath, 'utf8');
  const before = json5.parse(original);

  const rules = Array.isArray(before.rules) ? before.rules : [];
  const target = rules.find((r) => r && r.name === ruleName);
  if (!target) throw new Error(`regola non trovata: ${ruleName}`);

  const previous = target.action;
  if (previous === action) return { changed: false, previous };

  const lines = original.split('\n');
  const block = findRuleBlock(lines, ruleName);
  if (!block) throw new Error(`blocco testuale della regola "${ruleName}" non individuabile`);

  // Cerca la riga `action:` DENTRO il blocco della regola, non nel file intero.
  const actionPattern = /^(\s*)(["']?action["']?\s*:\s*)(["'])[^"']*\3(\s*,?\s*)$/;
  let actionLine = -1;
  for (let i = block.start; i <= block.end; i++) {
    if (actionPattern.test(lines[i])) { actionLine = i; break; }
  }
  if (actionLine === -1) throw new Error(`riga "action" non trovata nella regola "${ruleName}"`);

  lines[actionLine] = lines[actionLine].replace(actionPattern,
    (_m, indent, key, quote, tail) => `${indent}${key}${quote}${action}${quote}${tail}`);

  const updated = lines.join('\n');

  // ── Verifica differenziale: la rete di sicurezza dell'edit testuale ──
  let after;
  try {
    after = json5.parse(updated);
  } catch (err) {
    throw new Error(`la modifica avrebbe prodotto JSON5 non valido: ${err.message}`);
  }

  const diff = describeDifference(before, after);
  const expected = `rules[${rules.indexOf(target)}].action`;
  if (diff.length !== 1 || diff[0] !== expected) {
    throw new Error(
      `la modifica avrebbe toccato più di quanto previsto (atteso ${expected}, `
      + `rilevato ${diff.length === 0 ? 'nulla' : diff.join(', ')}) — scrittura annullata`);
  }

  // Scrittura atomica: un lettore non può mai vedere il file a metà, e in
  // debugMode il motore rilegge le regole a ogni richiesta.
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, updated, 'utf8');
  fs.renameSync(tempPath, filePath);

  return { changed: true, previous };
}

/**
 * Elenca i path in notazione puntata dove due strutture differiscono.
 * Serve solo alla verifica differenziale, quindi si ferma alla prima differenza
 * per ramo e non tenta di descrivere modifiche complesse.
 *
 * @returns {string[]}
 */
function describeDifference(a, b, prefix = '') {
  if (a === b) return [];

  const bothObjects = a && b && typeof a === 'object' && typeof b === 'object'
    && Array.isArray(a) === Array.isArray(b);
  if (!bothObjects) return [prefix || '<root>'];

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const key of keys) {
    const childPrefix = Array.isArray(a) ? `${prefix}[${key}]` : (prefix ? `${prefix}.${key}` : key);
    out.push(...describeDifference(a[key], b[key], childPrefix));
  }
  return out;
}


// ─────────────────────────────────────────────────────────────────────────────
// SOSTITUZIONE DI UNA REGOLA INTERA (Vista C — form strutturato)
// ─────────────────────────────────────────────────────────────────────────────

/** Chiavi di una regola, nell'ordine in cui vanno scritte. */
const RULE_KEY_ORDER = [
  'name', 'enabled', 'category', 'description', 'appliesTo', 'action',
  'match', 'decoy', 'redirect', 'tarpit', 'escalate',
];

/** Una chiave si può scrivere senza virgolette? Il file distribuito lo fa. */
const BARE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Serializza un valore in JSON5, nello stile del file distribuito: chiavi senza
 * virgolette quando sono identificatori, stringhe fra doppi apici, virgola
 * finale sugli oggetti e sugli array multi-riga.
 *
 * Non si usa `JSON.stringify`: produrrebbe chiavi virgolettate ovunque, e questo
 * file è fatto per essere letto a mano quanto per essere parsato.
 */
function serializeValue(value, indent) {
  const pad = ' '.repeat(indent);
  const padInner = ' '.repeat(indent + 2);

  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    // Array di scalari brevi: su una riga, che è come si leggono meglio.
    const allScalar = value.every((v) => v === null || typeof v !== 'object');
    const oneLine = `[${value.map((v) => serializeValue(v, 0)).join(', ')}]`;
    if (allScalar && oneLine.length <= 76) return oneLine;
    return `[\n${value.map((v) => padInner + serializeValue(v, indent + 2)).join(',\n')},\n${pad}]`;
  }

  const keys = Object.keys(value).filter((k) => value[k] !== undefined);
  if (keys.length === 0) return '{}';
  const body = keys
    .map((k) => `${padInner}${BARE_KEY.test(k) ? k : JSON.stringify(k)}: ${serializeValue(value[k], indent + 2)}`)
    .join(',\n');
  return `{\n${body},\n${pad}}`;
}

/**
 * Serializza una regola come blocco di testo pronto da inserire nel file.
 *
 * @param {object} rule
 * @param {number} indent - spazi di rientro del blocco (di solito 4)
 * @returns {string} senza newline finale
 */
function serializeRule(rule, indent = 4) {
  const pad = ' '.repeat(indent);
  const ordered = {};
  for (const key of RULE_KEY_ORDER) {
    if (rule[key] !== undefined) ordered[key] = rule[key];
  }
  // Chiavi non previste dall'ordine: conservate in coda invece che perse. Una
  // chiave sconosciuta è quasi sempre un refuso, ma cancellarla in silenzio
  // sarebbe peggio che lasciarla dov'è e farla vedere.
  for (const key of Object.keys(rule)) {
    if (ordered[key] === undefined && rule[key] !== undefined) ordered[key] = rule[key];
  }
  return pad + serializeValue(ordered, indent);
}

/**
 * Sostituisce una regola intera, lasciando intatto tutto il resto del file.
 *
 * ─── COSA SI PERDE, E PERCHE VA DETTO ─────────────────────────────────────────
 * Il blocco testuale della regola viene RISCRITTO: i commenti scritti **dentro
 * quella regola** spariscono. Quelli delle altre regole, le cornici di sezione e
 * l'intestazione del file restano dove sono.
 *
 * È una perdita reale e non evitabile con questo approccio — il form conosce i
 * campi, non i commenti — quindi va dichiarata nell'interfaccia invece che
 * scoperta dopo. L'alternativa (non offrire il form) costerebbe di più.
 *
 * ─── LA RETE ──────────────────────────────────────────────────────────────────
 * Stessa verifica differenziale di `setRuleAction`, allargata: dopo la
 * sostituzione ogni differenza deve stare **dentro** `rules[i]`. Se il blocco
 * individuato fosse quello sbagliato, la differenza spunterebbe altrove e la
 * scrittura viene annullata prima di toccare il file.
 *
 * @param {string} filePath
 * @param {string} ruleName - la regola da sostituire (il nome NON può cambiare)
 * @param {object} newRule  - la regola completa, già validata dal chiamante
 * @returns {{ changed: boolean }}
 */
function replaceRule(filePath, ruleName, newRule) {
  if (!newRule || newRule.name !== ruleName) {
    // Rinominare azzererebbe la storia della regola: contatori, righe di log e
    // promozioni sono legati al nome. Si fa dall'editor JSON5, consapevolmente.
    throw new Error('il nome di una regola non si cambia dal form: è la chiave che lega contatori e log');
  }

  const original = fs.readFileSync(filePath, 'utf8');
  const before = json5.parse(original);
  const rules = Array.isArray(before.rules) ? before.rules : [];
  const index = rules.findIndex((r) => r && r.name === ruleName);
  if (index === -1) throw new Error(`regola non trovata: ${ruleName}`);

  const lines = original.split('\n');
  const block = findRuleBlock(lines, ruleName);
  if (!block) throw new Error(`blocco testuale della regola "${ruleName}" non individuabile`);

  const indent = (lines[block.start].match(/^\s*/) || [''])[0].length;
  const hadTrailingComma = /,\s*$/.test(lines[block.end]);
  const replacement = serializeRule(newRule, indent) + (hadTrailingComma ? ',' : '');

  const updated = [
    ...lines.slice(0, block.start),
    ...replacement.split('\n'),
    ...lines.slice(block.end + 1),
  ].join('\n');

  let after;
  try {
    after = json5.parse(updated);
  } catch (err) {
    throw new Error(`la modifica avrebbe prodotto JSON5 non valido: ${err.message}`);
  }

  const fuori = describeDifference(before, after).filter((pathStr) => !pathStr.startsWith(`rules[${index}]`));
  if (fuori.length > 0) {
    throw new Error(
      `la modifica avrebbe toccato anche ${fuori.join(', ')} — scrittura annullata`);
  }
  if ((after.rules || []).length !== rules.length) {
    throw new Error('la modifica avrebbe cambiato il numero di regole — scrittura annullata');
  }

  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, updated, 'utf8');
  fs.renameSync(tempPath, filePath);

  return { changed: true };
}

module.exports = {
  setRuleAction, replaceRule, serializeRule,
  findRuleBlock, countBraces, scanBraces, describeDifference,
};
