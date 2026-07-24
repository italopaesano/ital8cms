const { parseArgs } = require('../../../scripts/lib/cliArgs');

describe('parseArgs', () => {
  test('boolean flags', () => {
    expect(parseArgs(['--dry-run', '--yes'])).toEqual({ _: [], flags: { 'dry-run': true, yes: true } });
  });

  test('--no-flag → false', () => {
    expect(parseArgs(['--no-git']).flags).toEqual({ git: false });
  });

  test('--key=value', () => {
    expect(parseArgs(['--tag=v1.2.3']).flags).toEqual({ tag: 'v1.2.3' });
  });

  test('--key value only when key is in valueKeys', () => {
    expect(parseArgs(['--tag', 'v1.2.3'], ['tag']).flags).toEqual({ tag: 'v1.2.3' });
    // senza valueKeys, --tag è booleano e "v1.2.3" è posizionale
    expect(parseArgs(['--tag', 'v1.2.3'])).toEqual({ _: ['v1.2.3'], flags: { tag: true } });
  });

  test('positionals collected', () => {
    expect(parseArgs(['delete', 'backup-x', '--yes']))
      .toEqual({ _: ['delete', 'backup-x'], flags: { yes: true } });
  });

  test('value flag does not swallow a following flag', () => {
    // --label senza valore seguito da --json → label booleano, json booleano
    expect(parseArgs(['--label', '--json'], ['label']).flags).toEqual({ label: true, json: true });
  });
});
