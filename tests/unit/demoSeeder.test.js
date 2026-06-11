// Questo file segue lo standard del progetto ital8cms
//
// Unit test per scripts/lib/demoSeeder.js (motore di seeding del profilo demo).
// Filesystem isolato: ogni test costruisce una project-root finta in os.tmpdir().

const fs = require('fs');
const os = require('os');
const path = require('path');
const DemoSeeder = require('../../scripts/lib/demoSeeder');

function makeLogger() {
  return { info: jest.fn(), success: jest.fn(), warning: jest.fn() };
}

describe('demoSeeder', () => {
  let root;
  let logger;
  let seeder;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'demoSeeder-'));
    fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });
    logger = makeLogger();
    seeder = new DemoSeeder(logger, { projectRoot: root });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('convenzione A — *.demo.json5 co-locati', () => {
    test('copia X.demo.json5 su X.json5', async () => {
      const pdir = path.join(root, 'plugins', 'fooPlugin');
      fs.mkdirSync(pdir, { recursive: true });
      fs.writeFileSync(path.join(pdir, 'data.demo.json5'), '// demo\n{ "a": 1 }\n');

      await seeder.run();

      const target = path.join(pdir, 'data.json5');
      expect(fs.existsSync(target)).toBe(true);
      expect(fs.readFileSync(target, 'utf8')).toContain('"a": 1');
      expect(seeder.stats.demoFiles).toBe(1);
    });

    test('fa il backup del file preesistente prima di sovrascrivere', async () => {
      const pdir = path.join(root, 'plugins', 'fooPlugin');
      fs.mkdirSync(pdir, { recursive: true });
      fs.writeFileSync(path.join(pdir, 'data.json5'), '// originale\n{ "a": 0 }\n');
      fs.writeFileSync(path.join(pdir, 'data.demo.json5'), '// demo\n{ "a": 1 }\n');

      await seeder.run();

      expect(fs.readFileSync(path.join(pdir, 'data.json5'), 'utf8')).toContain('"a": 1');
      const bak = path.join(seeder.backupDir, 'plugins', 'fooPlugin', 'data.json5');
      expect(fs.existsSync(bak)).toBe(true);
      expect(fs.readFileSync(bak, 'utf8')).toContain('"a": 0');
      expect(seeder.stats.backedUp).toBe(1);
    });

    test('non fa backup se il target non esiste', async () => {
      const pdir = path.join(root, 'plugins', 'fooPlugin');
      fs.mkdirSync(pdir, { recursive: true });
      fs.writeFileSync(path.join(pdir, 'data.demo.json5'), '{ "a": 1 }');

      await seeder.run();
      expect(seeder.stats.backedUp).toBe(0);
    });

    test('salta node_modules/tests/scripts e dir nascoste', async () => {
      const pdir = path.join(root, 'plugins', 'fooPlugin');
      for (const skip of ['node_modules', 'tests', 'scripts', '.hidden']) {
        fs.mkdirSync(path.join(pdir, skip), { recursive: true });
        fs.writeFileSync(path.join(pdir, skip, 'x.demo.json5'), '{}');
      }
      await seeder.run();
      expect(seeder.stats.demoFiles).toBe(0);
    });
  });

  describe('convenzione B — mirror .demoData/', () => {
    test('copia .demoData/www in www/ (ricorsivo)', async () => {
      const demoWww = path.join(root, '.demoData', 'www');
      fs.mkdirSync(path.join(demoWww, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(demoWww, 'index.ejs'), 'HOME');
      fs.writeFileSync(path.join(demoWww, 'sub', 'page.ejs'), 'PAGE');

      await seeder.run();

      expect(fs.readFileSync(path.join(root, 'www', 'index.ejs'), 'utf8')).toBe('HOME');
      expect(fs.readFileSync(path.join(root, 'www', 'sub', 'page.ejs'), 'utf8')).toBe('PAGE');
      expect(seeder.stats.mirrorFiles).toBe(2);
    });

    test('ignora top-level non consentiti in .demoData/', async () => {
      fs.mkdirSync(path.join(root, '.demoData', 'secret'), { recursive: true });
      fs.writeFileSync(path.join(root, '.demoData', 'secret', 'x.txt'), 'NO');
      await seeder.run();
      expect(fs.existsSync(path.join(root, 'secret'))).toBe(false);
      expect(seeder.stats.mirrorFiles).toBe(0);
    });

    test('mirror con backup del file www preesistente', async () => {
      fs.mkdirSync(path.join(root, 'www'), { recursive: true });
      fs.writeFileSync(path.join(root, 'www', 'index.ejs'), 'OLD');
      fs.mkdirSync(path.join(root, '.demoData', 'www'), { recursive: true });
      fs.writeFileSync(path.join(root, '.demoData', 'www', 'index.ejs'), 'NEW');

      await seeder.run();

      expect(fs.readFileSync(path.join(root, 'www', 'index.ejs'), 'utf8')).toBe('NEW');
      const bak = path.join(seeder.backupDir, 'www', 'index.ejs');
      expect(fs.readFileSync(bak, 'utf8')).toBe('OLD');
    });

    test('nessuna .demoData/ → mirror saltato senza errori', async () => {
      await expect(seeder.run()).resolves.toBeDefined();
      expect(seeder.stats.mirrorFiles).toBe(0);
    });
  });

  describe('hook seedDemo()', () => {
    test('invoca seedDemo(context) sui plugin che lo espongono', async () => {
      const pdir = path.join(root, 'plugins', 'barPlugin', 'scripts');
      fs.mkdirSync(pdir, { recursive: true });
      fs.writeFileSync(path.join(pdir, 'init.js'), [
        "const fs = require('fs');",
        "const path = require('path');",
        'module.exports = {',
        '  async seedDemo(ctx) {',
        "    fs.writeFileSync(path.join(ctx.pathPluginFolder, 'SEEDED'), 'ok');",
        '    return { success: true };',
        '  }',
        '};'
      ].join('\n'));

      await seeder.run();

      expect(fs.existsSync(path.join(root, 'plugins', 'barPlugin', 'SEEDED'))).toBe(true);
      expect(seeder.stats.seedHooks).toBe(1);
    });

    test('un seedDemo che lancia non interrompe il seeding (warning)', async () => {
      const pdir = path.join(root, 'plugins', 'boomPlugin', 'scripts');
      fs.mkdirSync(pdir, { recursive: true });
      fs.writeFileSync(path.join(pdir, 'init.js'), "module.exports = { async seedDemo() { throw new Error('boom'); } };");

      await expect(seeder.run()).resolves.toBeDefined();
      expect(logger.warning).toHaveBeenCalled();
    });

    test('plugin senza seedDemo vengono ignorati', async () => {
      const pdir = path.join(root, 'plugins', 'plainPlugin', 'scripts');
      fs.mkdirSync(pdir, { recursive: true });
      fs.writeFileSync(path.join(pdir, 'init.js'), 'module.exports = { run(){} };');
      await seeder.run();
      expect(seeder.stats.seedHooks).toBe(0);
    });
  });

  test('run() ritorna le statistiche aggregate', async () => {
    const pdir = path.join(root, 'plugins', 'fooPlugin');
    fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, 'data.demo.json5'), '{ "a": 1 }');
    fs.mkdirSync(path.join(root, '.demoData', 'www'), { recursive: true });
    fs.writeFileSync(path.join(root, '.demoData', 'www', 'index.ejs'), 'HOME');

    const stats = await seeder.run();
    expect(stats).toMatchObject({ demoFiles: 1, mirrorFiles: 1 });
  });
});
