const fs = require('fs');
const path = require('path');

/**
 * ============================================================================
 * ejsIncludeResolver - Risoluzione statica dell'albero di include EJS
 * ============================================================================
 *
 * Dato un file EJS, ne raccoglie il sorgente insieme a quello di tutti i file
 * che include, ricorsivamente. Serve a chi deve cercare qualcosa "nel template
 * come verrà davvero renderizzato" senza renderizzarlo: un partial che fattorizza
 * una parte di sé in un sub-partial condiviso è corretto a runtime, e una ricerca
 * sul solo file radice lo darebbe per incompleto.
 *
 * Consumatore attuale: themeSys.validateThemeContent(), per verificare la presenza
 * degli hook obbligatori nei partial di un tema (issue #355).
 *
 * SEMANTICA — rispecchia quella di EJS (verificata su ejs 6.0.1):
 *   - un path relativo si risolve rispetto alla directory del file CHE INCLUDE,
 *     non rispetto a una views root;
 *   - l'estensione è opzionale: include('siteFooter') trova siteFooter.ejs;
 *   - un include verso un file inesistente fa fallire il render.
 *
 * LIMITE DICHIARATO: la risoluzione è testuale, quindi copre i soli path
 * letterali. `include(getThemePartPath('head.ejs'))` non è risolvibile senza
 * eseguire il template, e finisce in `unresolvedIncludes` perché il chiamante
 * possa dire che la ricerca è incompleta invece di fingere una risposta certa.
 *
 * ============================================================================
 */

// Oltre questa profondità l'albero non viene più espanso: è una cintura contro
// alberi patologici, non un limite che un tema reale possa incontrare.
const DEFAULT_MAX_DEPTH = 10;

const EJS_EXTENSION = '.ejs';

// Le espressioni non risolvibili finiscono in un messaggio: vanno troncate.
const MAX_EXPRESSION_LENGTH = 60;

/**
 * Legge una stringa letterale a partire dal carattere successivo alla virgoletta
 * di apertura, gestendo gli escape con backslash.
 * @returns {string|null} - Il contenuto, o null se la stringa non è terminata
 */
function readQuotedLiteral(source, contentStart, quoteChar) {
  let literal = '';

  for (let cursor = contentStart; cursor < source.length; cursor++) {
    const char = source[cursor];

    if (char === '\\') {
      literal += source[cursor + 1] || '';
      cursor++;
      continue;
    }
    if (char === quoteChar) return literal;
    if (char === '\n' && quoteChar !== '`') return null; // stringa non terminata

    literal += char;
  }

  return null;
}

/**
 * Estrae una descrizione breve dell'argomento non risolvibile, da mostrare
 * all'utente: fino alla parentesi che chiude la chiamata `include(` o al fine
 * riga, troncata. La profondità viene tracciata perché l'argomento è quasi
 * sempre a sua volta una chiamata — getThemePartPath('head.ejs') — e fermarsi
 * alla prima `)` restituirebbe un'espressione con le parentesi sbilanciate.
 */
function summariseExpression(source, expressionStart) {
  let expression = '';
  let openParens = 0;

  for (let cursor = expressionStart; cursor < source.length; cursor++) {
    const char = source[cursor];

    if (char === '\n') break;
    if (char === '(') openParens++;
    if (char === ')') {
      if (openParens === 0) break;
      openParens--;
    }

    expression += char;
  }

  expression = expression.trim();

  return expression.length > MAX_EXPRESSION_LENGTH
    ? `${expression.slice(0, MAX_EXPRESSION_LENGTH)}…`
    : expression;
}

/**
 * Legge il primo argomento di una chiamata `include(`.
 * @param {number} argumentStart - Indice del primo carattere dopo la parentesi
 * @returns {object} - { literalPath } se è una stringa letterale, altrimenti { expression }
 */
function readIncludeArgument(source, argumentStart) {
  let cursor = argumentStart;
  while (cursor < source.length && /\s/.test(source[cursor])) cursor++;

  const quoteChar = source[cursor];

  if (quoteChar === "'" || quoteChar === '"' || quoteChar === '`') {
    const literal = readQuotedLiteral(source, cursor + 1, quoteChar);

    // Un template literal con interpolazione è un'espressione a tutti gli effetti:
    // `${dir}/footer.ejs` non è un path noto finché il template non gira.
    const isInterpolated = quoteChar === '`' && literal !== null && literal.includes('${');

    if (literal !== null && !isInterpolated) {
      return { literalPath: literal };
    }
  }

  // `include()` senza argomenti, o con l'argomento su un'altra riga, non lascia
  // niente da mostrare: un segnaposto è meglio di un messaggio con un buco.
  const expression = summariseExpression(source, cursor);

  return { expression: expression === '' ? '(argomento non riconoscibile)' : expression };
}

/**
 * Estrae le sole regioni di CODICE di un template: ciò che sta dentro un tag EJS
 * e non è un commento.
 *
 * Un `include` conta solo se EJS lo esegue. Cercarlo nell'intero sorgente
 * scambierebbe per chiamate reali sia gli include dentro `<%# ... %>` — che EJS
 * non esegue mai, ed è il modo normale di disattivarne uno mentre si sviluppa —
 * sia le occorrenze dentro il markup, per esempio in una stringa di uno
 * `<script>` inline.
 */
function extractEjsCodeRegions(source) {
  const codeRegions = [];
  let cursor = 0;

  while (cursor < source.length) {
    const tagStart = source.indexOf('<%', cursor);
    if (tagStart === -1) break;

    // `<%%` è la forma con cui EJS stampa un `<%` letterale: non apre un tag
    if (source[tagStart + 2] === '%') {
      cursor = tagStart + 3;
      continue;
    }

    const tagEnd = source.indexOf('%>', tagStart + 2);
    if (tagEnd === -1) break; // tag non chiuso: non c'è codice da eseguire

    // `<%#` è un commento: il suo contenuto non viene mai eseguito
    if (source[tagStart + 2] !== '#') {
      codeRegions.push(source.slice(tagStart + 2, tagEnd));
    }

    cursor = tagEnd + 2;
  }

  return codeRegions;
}

/**
 * Trova tutte le chiamate `include(` eseguibili di un sorgente e ne classifica
 * l'argomento. Il carattere precedente non deve essere parte di un identificatore
 * né un punto, così `content.includes(` e `myInclude(` non vengono scambiati per
 * include EJS.
 *
 * LIMITE: un `include(` scritto dentro una stringa che sta a sua volta dentro un
 * tag EJS verrebbe contato. Caso patologico, e comunque non peggiore del silenzio.
 */
function findIncludeCalls(source) {
  const calls = [];
  const callPattern = /(^|[^\w.$])include\s*\(/g;

  for (const codeRegion of extractEjsCodeRegions(source)) {
    callPattern.lastIndex = 0;

    while (callPattern.exec(codeRegion) !== null) {
      calls.push(readIncludeArgument(codeRegion, callPattern.lastIndex));
    }
  }

  return calls;
}

/**
 * Verifica che un path risolto non esca lessicalmente dal perimetro consentito.
 *
 * NON è un confine di sicurezza, ed è bene non scambiarlo per tale: il controllo
 * è puramente lessicale e non risolve i symlink, ma soprattutto non ci sarebbe
 * niente da difendere — il tema è codice che EJS eseguirà comunque, seguendo
 * esattamente gli stessi include (symlink compresi). Il perimetro serve a
 * limitare l'ampiezza della ricerca a ciò che appartiene al tema, così che un
 * hook trovato fuori non venga accreditato al tema per sbaglio.
 */
function isInsidePerimeter(candidatePath, rootPath) {
  if (!rootPath) return true;

  const relativePath = path.relative(rootPath, candidatePath);

  return relativePath !== '' &&
         !relativePath.startsWith('..') &&
         !path.isAbsolute(relativePath);
}

/**
 * Risolve un path letterale nelle due forme accettate da EJS: così com'è, e con
 * l'estensione .ejs aggiunta.
 * @returns {string|null} - Il path del file esistente, o null se nessuno esiste
 */
function findExistingTarget(includingFilePath, literalPath) {
  const basePath = path.resolve(path.dirname(includingFilePath), literalPath);

  for (const candidatePath of [basePath, basePath + EJS_EXTENSION]) {
    // Una sola stat invece di existsSync + statSync: metà delle syscall, e
    // nessuna finestra fra le due in cui il file possa sparire (un salvataggio
    // atomico dell'editor mentre nodemon riavvia) facendo lanciare la seconda.
    const candidateStats = fs.statSync(candidatePath, { throwIfNoEntry: false });

    if (candidateStats && candidateStats.isFile()) return candidatePath;
  }

  return null;
}

/**
 * Raccoglie il sorgente di un file EJS e di tutti i file che include.
 *
 * @param {string} entryFilePath - File di partenza (la sua lettura può lanciare:
 *                                 è il chiamante a sapere come riportare l'errore)
 * @param {object} options
 * @param {string} options.rootPath - Perimetro entro cui restare (es. la cartella del tema)
 * @param {number} [options.maxDepth=10] - Profondità massima di espansione
 * @returns {object} - {
 *   reachedFiles:       Array<{ filePath, content }>  file letti, il primo è entryFilePath
 *   unresolvedIncludes: Array<{ filePath, expression }> include di cui non si sa il target
 *   missingIncludes:    Array<{ filePath, target }>   include il cui target non esiste
 * }
 */
function resolveIncludeTree(entryFilePath, { rootPath = null, maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  const reachedFiles = [];
  const unresolvedIncludes = [];
  const missingIncludes = [];

  const normalisedRoot = rootPath ? path.resolve(rootPath) : null;
  const entryPath = path.resolve(entryFilePath);

  const visitedPaths = new Set([entryPath]);
  const pendingFiles = [{ filePath: entryPath, content: fs.readFileSync(entryPath, 'utf8'), depth: 0 }];

  while (pendingFiles.length > 0) {
    const { filePath, content, depth } = pendingFiles.shift();
    reachedFiles.push({ filePath, content });

    for (const includeCall of findIncludeCalls(content)) {
      // Path calcolato: non risolvibile senza eseguire il template
      if (includeCall.expression !== undefined) {
        unresolvedIncludes.push({ filePath, expression: includeCall.expression });
        continue;
      }

      // Troncamento dichiarato: meglio un'incertezza esplicita di un silenzio
      if (depth >= maxDepth) {
        unresolvedIncludes.push({
          filePath,
          expression: `'${includeCall.literalPath}' (profondità massima ${maxDepth} raggiunta)`
        });
        continue;
      }

      const basePath = path.resolve(path.dirname(filePath), includeCall.literalPath);
      if (!isInsidePerimeter(basePath, normalisedRoot)) {
        unresolvedIncludes.push({
          filePath,
          expression: `'${includeCall.literalPath}' (fuori dal perimetro consentito)`
        });
        continue;
      }

      const targetPath = findExistingTarget(filePath, includeCall.literalPath);
      if (targetPath === null) {
        missingIncludes.push({ filePath, target: includeCall.literalPath });
        continue;
      }

      // Un file già visitato non viene riespanso: chiude i cicli e la doppia lettura
      if (visitedPaths.has(targetPath)) continue;
      visitedPaths.add(targetPath);

      let targetContent;
      try {
        targetContent = fs.readFileSync(targetPath, 'utf8');
      } catch (error) {
        // Il file c'è ma non si legge (permessi): il target è noto, il contenuto no
        unresolvedIncludes.push({
          filePath,
          expression: `'${includeCall.literalPath}' (lettura fallita: ${error.code || error.message})`
        });
        continue;
      }

      pendingFiles.push({ filePath: targetPath, content: targetContent, depth: depth + 1 });
    }
  }

  return { reachedFiles, unresolvedIncludes, missingIncludes };
}

module.exports = resolveIncludeTree;
