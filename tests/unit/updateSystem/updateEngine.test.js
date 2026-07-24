const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  versionFromTag, selectLatest, checkout, parseOwnerRepo, currentVersion, isGitRepo,
} = require('../../../scripts/lib/updateEngine');

describe('parseOwnerRepo', () => {
  test.each([
    ['https://github.com/italopaesano/ital8cms.git', { owner: 'italopaesano', repo: 'ital8cms' }],
    ['https://github.com/italopaesano/ital8cms', { owner: 'italopaesano', repo: 'ital8cms' }],
    ['git@github.com:italopaesano/ital8cms.git', { owner: 'italopaesano', repo: 'ital8cms' }],
    ['http://127.0.0.1:41729/git/italopaesano/ital8cms', { owner: 'italopaesano', repo: 'ital8cms' }],
  ])('%s', (url, expected) => {
    expect(parseOwnerRepo(url)).toEqual(expected);
  });

  test('null / unrecognized → null', () => {
    expect(parseOwnerRepo(null)).toBeNull();
    expect(parseOwnerRepo('')).toBeNull();
  });
});

describe('currentVersion / isGitRepo', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ital8-ue-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('currentVersion reads package.json', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '9.9.9' }));
    expect(currentVersion(dir)).toBe('9.9.9');
  });

  test('currentVersion null when no/invalid package.json', () => {
    expect(currentVersion(dir)).toBeNull();
  });

  test('isGitRepo reflects .git presence', () => {
    expect(isGitRepo(dir)).toBe(false);
    fs.mkdirSync(path.join(dir, '.git'));
    expect(isGitRepo(dir)).toBe(true);
  });
});


describe('checkout ref guard (option-injection)', () => {
  test.each(['-x', '--upload-pack=evil', '', null])('rejects ambiguous ref %j before touching git', (ref) => {
    expect(() => checkout('/tmp', ref)).toThrow(/ref non valido/);
  });
});

describe('versionFromTag', () => {
  test.each([
    ['v0.0.1-alpha.4', '0.0.1-alpha.4'],
    ['0.0.1-alpha.4', '0.0.1-alpha.4'],
    ['v1.2.3', '1.2.3'],
    // normalizzazione convenzione prerelease "parola-numero" → "parola.numero"
    ['v0.0.1-beta-3', '0.0.1-beta.3'],
    ['v2.0.0-rc-1', '2.0.0-rc.1'],
  ])('%s → %s', (tag, expected) => {
    expect(versionFromTag(tag)).toBe(expected);
  });

  test('non-semver → null', () => {
    expect(versionFromTag('release-latest')).toBeNull();
    expect(versionFromTag('v')).toBeNull();
  });
});

describe('selectLatest', () => {
  test('picks the highest semver tag', () => {
    const r = selectLatest(['v1.0.0', 'v1.2.0', 'v1.1.0'], '1.0.0');
    expect(r.target).toEqual({ tag: 'v1.2.0', version: '1.2.0' });
    expect(r.isNewer).toBe(true);
  });

  test('not newer when current already latest', () => {
    const r = selectLatest(['v1.0.0', 'v1.1.0'], '1.1.0');
    expect(r.target.version).toBe('1.1.0');
    expect(r.isNewer).toBe(false);
  });

  test('prerelease ordering: beta-3 (hyphen) vs beta.4 (dot) normalize consistently', () => {
    // Senza normalizzazione "beta-3" ordinerebbe SOPRA "beta.4" (ASCII).
    const r = selectLatest(['v0.0.1-beta-3', 'v0.0.1-beta.4'], '0.0.1-alpha.3');
    expect(r.target.tag).toBe('v0.0.1-beta.4');
    expect(r.isNewer).toBe(true);
  });

  test('alpha < beta ordering', () => {
    const r = selectLatest(['v0.0.1-alpha.4', 'v0.0.1-beta-1'], '0.0.1-alpha.3');
    expect(r.target.tag).toBe('v0.0.1-beta-1'); // beta > alpha
    expect(r.target.version).toBe('0.0.1-beta.1');
  });

  test('reports and skips non-semver tags', () => {
    const r = selectLatest(['v1.0.0', 'nightly', 'latest'], '0.9.0');
    expect(r.target.version).toBe('1.0.0');
    expect(r.skipped.sort()).toEqual(['latest', 'nightly']);
  });

  test('no valid tags → no target', () => {
    const r = selectLatest(['nightly', 'latest'], '1.0.0');
    expect(r.target).toBeNull();
    expect(r.isNewer).toBe(false);
  });
});
