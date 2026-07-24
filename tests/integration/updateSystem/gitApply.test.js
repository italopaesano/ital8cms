/**
 * Integrazione: valida i primitivi git dell'updater (strada B) su un repo
 * usa-e-getta con un remote bare locale. Punto chiave: `git checkout <tag>`
 * allinea i file TRACCIATI e NON tocca gli untracked (dati utente).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const updateEngine = require('../../../scripts/lib/updateEngine');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}

let base, remote, work;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-gitapply-'));
  remote = path.join(base, 'remote.git');
  work = path.join(base, 'work');

  fs.mkdirSync(remote);
  git(remote, ['init', '--bare', '-b', 'main']);

  fs.mkdirSync(work);
  git(work, ['init', '-b', 'main']);
  git(work, ['config', 'user.email', 'test@example.com']);
  git(work, ['config', 'user.name', 'Test']);
  git(work, ['remote', 'add', 'origin', remote]);

  // Release v1.0.0
  fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }, null, 2));
  fs.writeFileSync(path.join(work, 'old.txt'), 'old');
  git(work, ['add', '-A']);
  git(work, ['commit', '-m', 'v1']);
  git(work, ['tag', 'v1.0.0']);

  // Release v1.1.0: aggiunge new.txt, rimuove old.txt, bump versione
  fs.rmSync(path.join(work, 'old.txt'));
  fs.writeFileSync(path.join(work, 'new.txt'), 'new');
  fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'x', version: '1.1.0' }, null, 2));
  git(work, ['add', '-A']);
  git(work, ['commit', '-m', 'v1.1.0']);
  git(work, ['tag', 'v1.1.0']);

  git(work, ['push', 'origin', 'main', '--tags']);

  // Simula l'installazione "vecchia": torna a v1.0.0 (detached)
  git(work, ['checkout', '--detach', 'v1.0.0']);
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

test('discover finds the newer release from the remote tags', () => {
  const d = updateEngine.discover(work);
  expect(d.current).toBe('1.0.0');
  expect(d.target).toEqual({ tag: 'v1.1.0', version: '1.1.0' });
  expect(d.isNewer).toBe(true);
});

test('trackedTreeStatus ignores untracked user data', () => {
  fs.writeFileSync(path.join(work, 'userdata.txt'), 'mine'); // untracked
  const st = updateEngine.trackedTreeStatus(work);
  expect(st.clean).toBe(true); // gli untracked non contano
});

test('checkout applies adds/deletes and preserves untracked files', () => {
  const rollbackRef = updateEngine.currentRef(work);
  updateEngine.fetchTags(work);
  updateEngine.checkout(work, 'v1.1.0');

  // file tracciati allineati alla release
  expect(fs.existsSync(path.join(work, 'new.txt'))).toBe(true);   // aggiunto
  expect(fs.existsSync(path.join(work, 'old.txt'))).toBe(false);  // rimosso upstream
  expect(JSON.parse(fs.readFileSync(path.join(work, 'package.json'), 'utf8')).version).toBe('1.1.0');
  // dato utente untracked preservato
  expect(fs.readFileSync(path.join(work, 'userdata.txt'), 'utf8')).toBe('mine');

  // rollback: torna al ref vecchio → old.txt riappare, new.txt sparisce, userdata resta
  updateEngine.checkout(work, rollbackRef);
  expect(fs.existsSync(path.join(work, 'old.txt'))).toBe(true);
  expect(fs.existsSync(path.join(work, 'new.txt'))).toBe(false);
  expect(fs.readFileSync(path.join(work, 'userdata.txt'), 'utf8')).toBe('mine');
});
