/**
 * Unit Tests per core/ejsIncludeResolver.js
 *
 * Risoluzione statica dell'albero di include EJS. La semantica di riferimento è
 * quella di EJS 6.0.1, verificata con un render vero: path relativo alla
 * directory del file CHE INCLUDE, estensione opzionale, include verso un file
 * inesistente che fa fallire il render.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const resolveIncludeTree = require('../../core/ejsIncludeResolver');

describe('ejsIncludeResolver', () => {
  let themeRoot;

  /** Scrive i file passati (path relativo → contenuto) sotto la root temporanea */
  function writeTree(files) {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(themeRoot, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content, 'utf8');
    }
  }

  /** Risolve un file della root temporanea, col perimetro fissato alla root */
  function resolve(relativeEntry, options = {}) {
    return resolveIncludeTree(path.join(themeRoot, relativeEntry), { rootPath: themeRoot, ...options });
  }

  /** Concatena i sorgenti raggiunti, come fa validateThemeContent() */
  const joinedSource = (tree) => tree.reachedFiles.map(reached => reached.content).join('\n');

  beforeEach(() => {
    themeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-include-'));
  });

  afterEach(() => {
    fs.rmSync(themeRoot, { recursive: true, force: true });
  });

  describe('risoluzione dei path letterali', () => {
    test('il primo file raggiunto è sempre quello di partenza', () => {
      writeTree({ 'views/footer.ejs': 'FOOTER' });

      const tree = resolve('views/footer.ejs');

      expect(tree.reachedFiles).toHaveLength(1);
      expect(tree.reachedFiles[0].filePath).toBe(path.join(themeRoot, 'views/footer.ejs'));
      expect(tree.reachedFiles[0].content).toBe('FOOTER');
    });

    test('segue un include letterale nella stessa directory', () => {
      writeTree({
        'views/footer.ejs': '<%- include("siteFooter.ejs") %>',
        'views/siteFooter.ejs': 'HOOK_FOOTER'
      });

      expect(joinedSource(resolve('views/footer.ejs'))).toContain('HOOK_FOOTER');
    });

    test('accetta l\'estensione omessa, come EJS', () => {
      writeTree({
        'views/footer.ejs': '<%- include("siteFooter") %>',
        'views/siteFooter.ejs': 'HOOK_FOOTER'
      });

      const tree = resolve('views/footer.ejs');

      expect(joinedSource(tree)).toContain('HOOK_FOOTER');
      expect(tree.missingIncludes).toHaveLength(0);
    });

    test('risolve rispetto al file che include, non alla radice', () => {
      writeTree({
        'views/footer.ejs': '<%- include("parts/inner.ejs") %>',
        'views/parts/inner.ejs': 'INNER <%- include("../sibling.ejs") %>',
        'views/sibling.ejs': 'SIBLING'
      });

      const source = joinedSource(resolve('views/footer.ejs'));

      expect(source).toContain('INNER');
      expect(source).toContain('SIBLING');
    });

    test('accetta tutte e tre le forme di quoting', () => {
      writeTree({
        'views/footer.ejs': '<%- include("a.ejs") %><%- include(\'b.ejs\') %><%- include(`c.ejs`) %>',
        'views/a.ejs': 'AAA',
        'views/b.ejs': 'BBB',
        'views/c.ejs': 'CCC'
      });

      const source = joinedSource(resolve('views/footer.ejs'));

      expect(source).toContain('AAA');
      expect(source).toContain('BBB');
      expect(source).toContain('CCC');
    });

    test('segue l\'include anche con un secondo argomento (i local EJS)', () => {
      // È la forma del workaround adottato nella issue #355
      writeTree({
        'views/footer.ejs': '<%- include("siteFooter.ejs", { footerHook: x }) %>',
        'views/siteFooter.ejs': 'HOOK_FOOTER'
      });

      expect(joinedSource(resolve('views/footer.ejs'))).toContain('HOOK_FOOTER');
    });

    test('legge una sola volta un file incluso due volte', () => {
      writeTree({
        'views/footer.ejs': '<%- include("shared.ejs") %><%- include("shared.ejs") %>',
        'views/shared.ejs': 'SHARED'
      });

      const tree = resolve('views/footer.ejs');

      expect(tree.reachedFiles).toHaveLength(2);
    });
  });

  describe('include non risolvibili', () => {
    test('un path calcolato non viene risolto ma viene dichiarato', () => {
      writeTree({
        'views/footer.ejs': '<%- include(passData.themeSys.getThemePartPath("head.ejs")) %>'
      });

      const tree = resolve('views/footer.ejs');

      expect(tree.unresolvedIncludes).toHaveLength(1);
      // L'espressione arriva intera: fermarsi alla prima ")" la sbilancerebbe
      expect(tree.unresolvedIncludes[0].expression)
        .toBe('passData.themeSys.getThemePartPath("head.ejs")');
      expect(tree.missingIncludes).toHaveLength(0);
    });

    test('un template literal con interpolazione è un\'espressione, non un path', () => {
      writeTree({ 'views/footer.ejs': '<%- include(`${dir}/siteFooter.ejs`) %>' });

      const tree = resolve('views/footer.ejs');

      expect(tree.unresolvedIncludes).toHaveLength(1);
      expect(tree.missingIncludes).toHaveLength(0);
    });

    test('un include fuori dal perimetro non viene seguito', () => {
      const outsidePath = path.join(themeRoot, '..', 'outside.ejs');
      fs.writeFileSync(outsidePath, 'OUTSIDE', 'utf8');

      try {
        writeTree({ 'views/footer.ejs': '<%- include("../../outside.ejs") %>' });

        const tree = resolve('views/footer.ejs');

        expect(joinedSource(tree)).not.toContain('OUTSIDE');
        expect(tree.unresolvedIncludes).toHaveLength(1);
        expect(tree.unresolvedIncludes[0].expression).toContain('fuori dal perimetro');
      } finally {
        fs.rmSync(outsidePath, { force: true });
      }
    });

    test('oltre maxDepth l\'espansione si ferma e lo dichiara', () => {
      writeTree({
        'views/footer.ejs': '<%- include("a.ejs") %>',
        'views/a.ejs': 'A <%- include("b.ejs") %>',
        'views/b.ejs': 'B_PROFONDO'
      });

      const tree = resolve('views/footer.ejs', { maxDepth: 1 });

      expect(joinedSource(tree)).not.toContain('B_PROFONDO');
      expect(tree.unresolvedIncludes[0].expression).toContain('profondità massima');
    });
  });

  describe('include verso file inesistenti', () => {
    test('finiscono in missingIncludes, non fra i non risolvibili', () => {
      writeTree({ 'views/footer.ejs': '<%- include("siteFooter.ejs") %>' });

      const tree = resolve('views/footer.ejs');

      expect(tree.missingIncludes).toHaveLength(1);
      expect(tree.missingIncludes[0].target).toBe('siteFooter.ejs');
      expect(tree.missingIncludes[0].filePath).toBe(path.join(themeRoot, 'views/footer.ejs'));
      expect(tree.unresolvedIncludes).toHaveLength(0);
    });

    test('vengono attribuiti al file che li contiene, non alla radice', () => {
      writeTree({
        'views/footer.ejs': '<%- include("siteFooter.ejs") %>',
        'views/siteFooter.ejs': '<%- include("mancante.ejs") %>'
      });

      const tree = resolve('views/footer.ejs');

      expect(tree.missingIncludes[0].filePath).toBe(path.join(themeRoot, 'views/siteFooter.ejs'));
    });
  });

  describe('robustezza', () => {
    test('un ciclo A → B → A non manda in loop', () => {
      writeTree({
        'views/footer.ejs': 'FOOTER <%- include("siteFooter.ejs") %>',
        'views/siteFooter.ejs': 'SITE <%- include("footer.ejs") %>'
      });

      const tree = resolve('views/footer.ejs');

      expect(tree.reachedFiles).toHaveLength(2);
      expect(joinedSource(tree)).toContain('SITE');
    });

    test('content.includes( non viene scambiato per un include EJS', () => {
      writeTree({ 'views/footer.ejs': '<% if (content.includes("x.ejs")) { } %>' });

      const tree = resolve('views/footer.ejs');

      expect(tree.reachedFiles).toHaveLength(1);
      expect(tree.unresolvedIncludes).toHaveLength(0);
      expect(tree.missingIncludes).toHaveLength(0);
    });

    test('un file senza include produce un albero di un solo elemento', () => {
      writeTree({ 'views/footer.ejs': '<footer>niente include qui</footer>' });

      const tree = resolve('views/footer.ejs');

      expect(tree.reachedFiles).toHaveLength(1);
      expect(tree.unresolvedIncludes).toEqual([]);
      expect(tree.missingIncludes).toEqual([]);
    });

    test('la lettura del file di partenza lancia: la riporta il chiamante', () => {
      expect(() => resolve('views/inesistente.ejs')).toThrow();
    });
  });
});
