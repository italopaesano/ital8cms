/**
 * Unit Tests per core/installPluginNpmDeps.js
 *
 * Copre la logica PURA (no-op senza package.json, argomenti npm, sanificazione
 * env, opzione clean, callback onLog) mockando child_process.execFileSync così
 * NON viene mai lanciato un vero `npm install`.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Mock di child_process: execFileSync non deve MAI lanciare npm nei test.
jest.mock('child_process', () => ({ execFileSync: jest.fn() }));
const { execFileSync } = require('child_process');

const installPluginNpmDeps = require('../../../core/installPluginNpmDeps');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'installPluginNpmDeps-'));
  execFileSync.mockReset();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writePackageJson() {
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{ "name": "x", "version": "1.0.0" }\n', 'utf8');
}

describe('installPluginNpmDeps', () => {

  test('no-op senza package.json: ran=false, reason=no-package-json, npm mai invocato', () => {
    const result = installPluginNpmDeps(tmpDir);
    expect(result).toEqual({ ran: false, reason: 'no-package-json' });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  test('con package.json: esegue `npm install --no-audit --no-fund` nella cartella', () => {
    writePackageJson();
    const result = installPluginNpmDeps(tmpDir);

    expect(result).toEqual({ ran: true, subcommand: 'install' });
    expect(execFileSync).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = execFileSync.mock.calls[0];
    expect(cmd).toBe('npm');
    expect(args).toEqual(['install', '--no-audit', '--no-fund']);
    expect(opts.cwd).toBe(tmpDir);
    expect(opts.stdio).toBe('inherit');
  });

  test('opts.clean=true → usa `npm ci`', () => {
    writePackageJson();
    const result = installPluginNpmDeps(tmpDir, { clean: true });

    expect(result).toEqual({ ran: true, subcommand: 'ci' });
    const [, args] = execFileSync.mock.calls[0];
    expect(args).toEqual(['ci', '--no-audit', '--no-fund']);
  });

  test('sanificazione env: rimuove npm_config_prefix / npm_config_local_prefix / INIT_CWD', () => {
    writePackageJson();
    const saved = { ...process.env };
    process.env.npm_config_prefix = '/wrong/prefix';
    process.env.npm_config_local_prefix = '/wrong/local';
    process.env.INIT_CWD = '/wrong/initcwd';
    process.env.npm_config_registry = 'https://registry.example';

    try {
      installPluginNpmDeps(tmpDir);
      const opts = execFileSync.mock.calls[0][2];
      expect(opts.env.npm_config_prefix).toBeUndefined();
      expect(opts.env.npm_config_local_prefix).toBeUndefined();
      expect(opts.env.INIT_CWD).toBeUndefined();
      // le altre variabili (registry, proxy, cache) restano intatte
      expect(opts.env.npm_config_registry).toBe('https://registry.example');
    } finally {
      process.env = saved;
    }
  });

  test('onLog viene invocata col subcomando SOLO quando c\'è package.json', () => {
    const onLog = jest.fn();

    // senza package.json: onLog NON chiamata
    installPluginNpmDeps(tmpDir, { onLog });
    expect(onLog).not.toHaveBeenCalled();

    // con package.json: onLog chiamata con 'install'
    writePackageJson();
    installPluginNpmDeps(tmpDir, { onLog });
    expect(onLog).toHaveBeenCalledWith('install');
  });

  test('propaga (lancia) se npm esce con errore', () => {
    writePackageJson();
    execFileSync.mockImplementation(() => { throw new Error('npm exited with code 1'); });
    expect(() => installPluginNpmDeps(tmpDir)).toThrow(/npm exited with code 1/);
  });

  test('sanitizedNpmEnv è esportata e condivisibile', () => {
    expect(typeof installPluginNpmDeps.sanitizedNpmEnv).toBe('function');
    const env = installPluginNpmDeps.sanitizedNpmEnv();
    expect(env.npm_config_prefix).toBeUndefined();
    expect(env.npm_config_local_prefix).toBeUndefined();
    expect(env.INIT_CWD).toBeUndefined();
  });

  test('dir inesistente: no-op senza lanciare (package.json non trovato)', () => {
    const missingDir = path.join(tmpDir, 'does', 'not', 'exist');
    const result = installPluginNpmDeps(missingDir);
    expect(result).toEqual({ ran: false, reason: 'no-package-json' });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  test('opts.stdio custom viene propagato a execFileSync', () => {
    writePackageJson();
    installPluginNpmDeps(tmpDir, { stdio: 'ignore' });
    expect(execFileSync.mock.calls[0][2].stdio).toBe('ignore');
  });

  test('clean + onLog insieme: onLog riceve il subcomando "ci"', () => {
    writePackageJson();
    const onLog = jest.fn();
    installPluginNpmDeps(tmpDir, { clean: true, onLog });
    expect(onLog).toHaveBeenCalledWith('ci');
    expect(execFileSync.mock.calls[0][1]).toEqual(['ci', '--no-audit', '--no-fund']);
  });

  test('default export e proprietà .installPluginNpmDeps sono la stessa funzione', () => {
    expect(installPluginNpmDeps.installPluginNpmDeps).toBe(installPluginNpmDeps);
  });
});
