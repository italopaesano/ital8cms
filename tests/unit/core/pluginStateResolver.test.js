/**
 * Unit Tests per core/pluginStateResolver.js (logica pura: precondizioni + stati + cascata).
 */

const { checkNpmDeps, resolvePluginStates, detectCycles } = require('../../../core/pluginStateResolver');

// Helper: costruisce un candidato.
function cand(name, { version = '1.0.0', npmOk = true, deps = {} } = {}) {
  return {
    name,
    version,
    npmOk,
    npmDetail: npmOk ? null : { missing: [{ name: 'x', required: '^1' }], incompatible: [] },
    pluginDeps: new Map(Object.entries(deps)),
  };
}

describe('checkNpmDeps', () => {
  const installed = { foo: '1.2.3', bar: '2.0.0' };
  const resolve = (name) => installed[name] || null;

  test('ok when there are no deps', () => {
    expect(checkNpmDeps(undefined, resolve)).toEqual({ ok: true, missing: [], incompatible: [] });
    expect(checkNpmDeps({}, resolve).ok).toBe(true);
  });

  test('ok when installed and compatible', () => {
    const r = checkNpmDeps({ foo: '^1.0.0' }, resolve);
    expect(r.ok).toBe(true);
  });

  test('reports a missing module', () => {
    const r = checkNpmDeps({ qux: '^1.0.0' }, resolve);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([{ name: 'qux', required: '^1.0.0' }]);
  });

  test('reports an incompatible version', () => {
    const r = checkNpmDeps({ foo: '^2.0.0' }, resolve);
    expect(r.ok).toBe(false);
    expect(r.incompatible).toEqual([{ name: 'foo', required: '^2.0.0', installed: '1.2.3' }]);
  });

  test('mixes missing and incompatible', () => {
    const r = checkNpmDeps({ foo: '^9', qux: '^1' }, resolve);
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(1);
    expect(r.incompatible).toHaveLength(1);
  });
});

describe('resolvePluginStates', () => {
  function statesOf(candidates) {
    return resolvePluginStates(candidates);
  }

  test('all installed when no deps and npm ok', () => {
    const s = statesOf([cand('a'), cand('b')]);
    expect(s.get('a').state).toBe('installed');
    expect(s.get('b').state).toBe('installed');
  });

  test('npm failure → incomplete (reason npm)', () => {
    const s = statesOf([cand('a', { npmOk: false })]);
    expect(s.get('a')).toMatchObject({ state: 'incomplete', reason: 'npm' });
  });

  test('missing plugin dependency → incomplete (dep-missing)', () => {
    const s = statesOf([cand('a', { deps: { ghost: '^1.0.0' } })]);
    expect(s.get('a')).toMatchObject({ state: 'incomplete', reason: 'dep-missing' });
  });

  test('incompatible dependency version → incomplete (dep-version)', () => {
    const s = statesOf([cand('a', { deps: { b: '^2.0.0' } }), cand('b', { version: '1.0.0' })]);
    expect(s.get('a')).toMatchObject({ state: 'incomplete', reason: 'dep-version' });
    expect(s.get('b').state).toBe('installed');
  });

  test('satisfied dependency → installed', () => {
    const s = statesOf([cand('a', { deps: { b: '^1.0.0' } }), cand('b', { version: '1.5.0' })]);
    expect(s.get('a').state).toBe('installed');
    expect(s.get('b').state).toBe('installed');
  });

  test('cascade: dependency incomplete → dependent incomplete (dep-incomplete)', () => {
    const s = statesOf([
      cand('a', { deps: { b: '^1.0.0' } }),
      cand('b', { npmOk: false }), // b incomplete (npm)
    ]);
    expect(s.get('b').reason).toBe('npm');
    expect(s.get('a')).toMatchObject({ state: 'incomplete', reason: 'dep-incomplete', detail: { dep: 'b' } });
  });

  test('transitive cascade: A→B→C, C incomplete → B and A incomplete', () => {
    const s = statesOf([
      cand('A', { deps: { B: '^1.0.0' } }),
      cand('B', { deps: { C: '^1.0.0' } }),
      cand('C', { npmOk: false }),
    ]);
    expect(s.get('C').reason).toBe('npm');
    expect(s.get('B')).toMatchObject({ state: 'incomplete', reason: 'dep-incomplete' });
    expect(s.get('A')).toMatchObject({ state: 'incomplete', reason: 'dep-incomplete' });
  });

  test('cycle A↔B → both incomplete (circular)', () => {
    const s = statesOf([
      cand('A', { deps: { B: '^1.0.0' } }),
      cand('B', { deps: { A: '^1.0.0' } }),
    ]);
    expect(s.get('A')).toMatchObject({ state: 'incomplete', reason: 'circular' });
    expect(s.get('B')).toMatchObject({ state: 'incomplete', reason: 'circular' });
  });

  test('self-loop → incomplete (circular)', () => {
    const s = statesOf([cand('A', { deps: { A: '^1.0.0' } })]);
    expect(s.get('A')).toMatchObject({ state: 'incomplete', reason: 'circular' });
  });

  test('external dependent of a cycle becomes incomplete too', () => {
    const s = statesOf([
      cand('A', { deps: { B: '^1.0.0' } }),
      cand('B', { deps: { A: '^1.0.0' } }),
      cand('C', { deps: { A: '^1.0.0' } }), // dipende dal ciclo
    ]);
    expect(s.get('A').reason).toBe('circular');
    expect(s.get('B').reason).toBe('circular');
    expect(s.get('C')).toMatchObject({ state: 'incomplete', reason: 'dep-incomplete' });
  });
});

describe('detectCycles', () => {
  function names(candidates) {
    return new Set(candidates.map((c) => c.name));
  }

  test('no cycle → empty set', () => {
    const cs = [cand('a', { deps: { b: '^1' } }), cand('b')];
    expect(detectCycles(cs, names(cs)).size).toBe(0);
  });

  test('chain without cycle → empty', () => {
    const cs = [cand('a', { deps: { b: '^1' } }), cand('b', { deps: { c: '^1' } }), cand('c')];
    expect(detectCycles(cs, names(cs)).size).toBe(0);
  });

  test('A↔B → {A, B}', () => {
    const cs = [cand('A', { deps: { B: '^1' } }), cand('B', { deps: { A: '^1' } })];
    expect([...detectCycles(cs, names(cs))].sort()).toEqual(['A', 'B']);
  });

  test('edges to non-candidates are ignored', () => {
    const cs = [cand('a', { deps: { ghost: '^1' } })];
    expect(detectCycles(cs, names(cs)).size).toBe(0);
  });
});
