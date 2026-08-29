/**
 * pluginLoadOrder — decide in che ORDINE caricare i plugin installabili.
 *
 * Modulo **puro**: nessun I/O, nessun filesystem, nessun logger. Riceve la lista
 * dei candidati già filtrati a `installed` da `pluginStateResolver` e restituisce
 * l'ordine, insieme a ciò che serve per spiegarlo. Gemello di
 * `core/pluginStateResolver.js`: quello decide CHI si carica, questo QUANDO.
 *
 * ─── PERCHÉ UN ORDINAMENTO SOLO ──────────────────────────────────────────────
 * Fino alla v3.14.0 l'ordine nasceva da due meccanismi diversi cuciti insieme:
 * un `sort` per `weight` applicato ai soli plugin **senza** dipendenze, e una
 * coda che accodava gli altri man mano che le dipendenze si risolvevano. Il
 * secondo scavalcava il primo: qualunque plugin con un `dependency` finiva dopo
 * **tutti** quelli senza, qualunque peso avesse dichiarato.
 *
 * MISURATO sulla configurazione distribuita: `adminAccessControl` dichiara
 * `weight: -5` — il più basso dopo `simpleI18n` — e caricava **22° su 22**,
 * perché dipende da `adminUsers`. Il suo peso non era « poco efficace »: era
 * inerte. E siccome l'ordine di caricamento è **anche** l'ordine in cui
 * `index.js` monta i middleware, un peso inerte è un middleware montato nel
 * punto sbagliato — la stessa classe di difetto che tolse i redirect dalle
 * statistiche in v3.0.0.
 *
 * ─── L'ALGORITMO ─────────────────────────────────────────────────────────────
 * Kahn con selezione del minimo, cioè un ordinamento topologico in cui, fra
 * tutti i plugin **pronti** in quel momento, si sceglie sempre quello di peso
 * minore (a parità di peso, il primo in ordine alfabetico):
 *
 *   1. pronti = installabili le cui dipendenze sono già state emesse;
 *   2. emetti il minimo per (weight, name);
 *   3. ripeti finché ci sono pronti.
 *
 * Il vincolo topologico resta **duro** — una dipendenza è sempre prima del suo
 * dipendente — e il peso decide tutto il resto. È la formulazione più fedele
 * possibile al contratto dichiarato in `CLAUDE.md`: *weight crescente, ma le
 * dipendenze prima dei dipendenti*.
 *
 * ─── QUANDO IL PESO NON PUÒ ESSERE ONORATO ───────────────────────────────────
 * Le due regole possono contraddirsi: `adminAccessControl` **non può** caricare
 * prima di `adminUsers`, quindi il suo `-5` non lo porterà mai davanti a un
 * plugin di peso 0 che `adminUsers` deve seguire. Non è un difetto
 * dell'algoritmo — è una richiesta impossibile — ma finora non lo diceva
 * nessuno, e chi leggeva `weight: -5` credeva di avere un middleware a monte.
 *
 * `weightInversions` raccoglie esattamente questi casi: un plugin caricato dopo
 * almeno un altro di peso **strettamente maggiore**, con la dipendenza che l'ha
 * frenato. La disuguaglianza è stretta di proposito: a parità di peso l'ordine
 * lo decide il tiebreak alfabetico, e scavalcarlo non tradisce nessuna
 * intenzione dichiarata.
 *
 * ─── COSA NON ORDINA ─────────────────────────────────────────────────────────
 * Un plugin che dipende da qualcosa fuori dagli installabili (dipendenza assente,
 * disattivata, o caduta al caricamento) non ha una posizione valida: finisce in
 * `unordered`, e il chiamante lo marca `incomplete` come faceva la vecchia coda.
 * Stessa sorte per i cicli, che `pluginStateResolver` intercetta già a monte:
 * qui il ramo esiste come rete, non come percorso previsto.
 *
 * API:
 *   resolveLoadOrder(installables) → { order, unordered, weightInversions }
 *     installables: Array<{ name: string, weight: number, pluginDeps: Map|Set|Array|Object }>
 *     order:        string[]  ordine di caricamento
 *     unordered:    string[]  installabili senza posizione valida (dep irrisolvibile o ciclo)
 *     weightInversions: Array<{
 *       name, weight, position,                          // position è 1-based
 *       blockingDep: { name, weight, position } | null,  // la dipendenza che ha frenato
 *       overtaken: Array<{ name, weight }>               // i più pesanti caricati prima
 *     }>
 */

'use strict';

/**
 * Normalizza le dipendenze dichiarate in un array di nomi, qualunque forma
 * abbiano nel candidato (`initialize()` costruisce una Map nome→range, ma il
 * modulo non deve dipendere da quella scelta per restare testabile da solo).
 *
 * @param {Map|Set|Array|object|undefined} deps
 * @returns {string[]}
 */
function dependencyNames(deps) {
  if (!deps) return [];
  if (deps instanceof Map || deps instanceof Set) return [...deps.keys()];
  if (Array.isArray(deps)) return deps.slice();
  if (typeof deps === 'object') return Object.keys(deps);
  return [];
}

/**
 * Confronto d'ordine: peso crescente, poi alfabetico.
 *
 * Il tiebreak alfabetico è esplicito e non affidato alla stabilità di `sort()`:
 * l'ordine con cui i candidati arrivano qui viene da `readdirSync`, che non è
 * garantito alfabetico su tutti i filesystem — « a parità di weight,
 * alfabetico » sarebbe stato vero solo per caso. Confronto diretto e non
 * `localeCompare`, per non dipendere dal locale della macchina.
 */
function byWeightThenName(a, b) {
  return (a.weight - b.weight) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

/**
 * Calcola l'ordine di caricamento dei plugin installabili.
 *
 * @param {Array<{name: string, weight: number, pluginDeps: *}>} installables
 * @returns {{order: string[], unordered: string[], weightInversions: object[]}}
 */
function resolveLoadOrder(installables) {
  if (!Array.isArray(installables)) {
    throw new Error('resolveLoadOrder: installables must be an array');
  }

  // Indice per nome, e insieme dei nomi ordinabili: una dipendenza fuori da
  // questo insieme non potrà MAI essere soddisfatta, perché il chiamante carica
  // solo ciò che sta qui dentro.
  const byName = new Map();
  for (const candidate of installables) {
    byName.set(candidate.name, {
      name: candidate.name,
      weight: Number.isFinite(candidate.weight) ? candidate.weight : 0,
      deps: dependencyNames(candidate.pluginDeps),
    });
  }

  const emitted = new Set();
  const order = [];

  // Kahn con selezione del minimo. O(n²) sul numero di plugin — con 22 plugin
  // reali è irrilevante, e la forma esplicita si legge meglio di un heap.
  let progress = true;
  while (progress) {
    progress = false;

    const ready = [];
    for (const node of byName.values()) {
      if (emitted.has(node.name)) continue;
      // Pronto = ogni dipendenza è ordinabile ED è già stata emessa.
      const satisfied = node.deps.every((dep) => emitted.has(dep));
      if (satisfied) ready.push(node);
    }
    if (ready.length === 0) break;

    ready.sort(byWeightThenName);
    const next = ready[0];
    emitted.add(next.name);
    order.push(next.name);
    progress = true;
  }

  // Rimasti fuori: dipendono da qualcosa che non è fra gli installabili, oppure
  // sono in un ciclo. Ordinati per (weight, name) così l'elenco è stabile.
  const unordered = [...byName.values()]
    .filter((node) => !emitted.has(node.name))
    .sort(byWeightThenName)
    .map((node) => node.name);

  return { order, unordered, weightInversions: findWeightInversions(order, byName) };
}

/**
 * Trova i plugin il cui `weight` non è stato onorato: quelli caricati dopo
 * almeno un plugin di peso **strettamente maggiore**.
 *
 * Per ciascuno individua anche la **dipendenza vincolante** — quella emessa più
 * tardi fra le sue — perché è la risposta alla domanda che uno si fa leggendo il
 * box: « e allora perché carica lì? ». Con più dipendenze alla stessa posizione
 * massima non può accadere (le posizioni sono uniche), quindi la scelta è
 * univoca.
 *
 * @param {string[]} order
 * @param {Map<string, {name: string, weight: number, deps: string[]}>} byName
 * @returns {object[]}
 */
function findWeightInversions(order, byName) {
  const positionOf = new Map(order.map((name, index) => [name, index]));
  const inversions = [];

  for (let i = 0; i < order.length; i++) {
    const node = byName.get(order[i]);

    const overtaken = [];
    for (let j = 0; j < i; j++) {
      const earlier = byName.get(order[j]);
      if (earlier.weight > node.weight) {
        overtaken.push({ name: earlier.name, weight: earlier.weight });
      }
    }
    if (overtaken.length === 0) continue;

    // La dipendenza emessa più tardi: è quella che ha fissato il « non prima di ».
    let blockingDep = null;
    for (const dep of node.deps) {
      const depPos = positionOf.get(dep);
      if (depPos === undefined) continue;
      if (blockingDep === null || depPos > blockingDep.position - 1) {
        blockingDep = { name: dep, weight: byName.get(dep).weight, position: depPos + 1 };
      }
    }

    inversions.push({
      name: node.name,
      weight: node.weight,
      position: i + 1,
      blockingDep,
      overtaken,
    });
  }

  return inversions;
}

module.exports = resolveLoadOrder;
module.exports.resolveLoadOrder = resolveLoadOrder;
