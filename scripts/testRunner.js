#!/usr/bin/env node
/**
 * testRunner.js
 *
 * Wrapper attorno a Jest per supportare il filtraggio dei test per scope:
 *   - --plugin=<nomePlugin>  → solo i test in plugins/<nome>/tests/
 *   - --themes               → solo i test in themes/<qualsiasi>/tests/
 *   - --core                 → solo i test in tests/unit/ e tests/integration/ del progetto
 *
 * Gli argomenti sono mutuamente esclusivi (se ne passa solo uno).
 *
 * NOTA: usato dai seguenti npm scripts:
 *   - test:plugin   (npm run test:plugin --plugin=nomePlugin)
 *   - test:themes
 *   - test:core
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const JEST_CONFIG = path.join(PROJECT_ROOT, 'tests', 'jest.config.js');

function parseArgs(argv) {
  const parsed = { plugin: null, themes: false, core: false, extraArgs: [] };
  for (const arg of argv) {
    if (arg.startsWith('--plugin=')) {
      parsed.plugin = arg.slice('--plugin='.length).trim();
    } else if (arg === '--themes') {
      parsed.themes = true;
    } else if (arg === '--core') {
      parsed.core = true;
    } else {
      parsed.extraArgs.push(arg);
    }
  }
  return parsed;
}

function printUsage() {
  console.error('Usage:');
  console.error('  node scripts/testRunner.js --plugin=<pluginName>');
  console.error('  node scripts/testRunner.js --themes');
  console.error('  node scripts/testRunner.js --core');
  console.error('');
  console.error('Tramite npm:');
  console.error('  npm run test:plugin --plugin=<pluginName>');
  console.error('  npm run test:themes');
  console.error('  npm run test:core');
}

function fail(message, exitCode = 2) {
  console.error(`[testRunner] ${message}`);
  printUsage();
  process.exit(exitCode);
}

function buildScope(args) {
  const modes = [args.plugin ? 'plugin' : null, args.themes ? 'themes' : null, args.core ? 'core' : null].filter(Boolean);

  if (modes.length === 0) {
    fail('Nessun scope specificato. Passa --plugin=<name>, --themes, oppure --core.');
  }
  if (modes.length > 1) {
    fail(`Scope mutuamente esclusivi: non puoi combinare ${modes.join(' + ')}.`);
  }

  if (args.plugin) {
    if (args.plugin === '') {
      fail('Nome del plugin vuoto. Esempio: npm run test:plugin --plugin=bootstrapNavbar');
    }
    const pluginDir = path.join(PROJECT_ROOT, 'plugins', args.plugin);
    if (!fs.existsSync(pluginDir)) {
      fail(`Il plugin '${args.plugin}' non esiste (cercato in ${pluginDir}).`);
    }
    const testsDir = path.join(pluginDir, 'tests');
    if (!fs.existsSync(testsDir)) {
      console.warn(
        `[testRunner] Avviso: il plugin '${args.plugin}' non ha una cartella tests/. ` +
        `Creala in plugins/${args.plugin}/tests/ per aggiungere test specifici.`
      );
    }
    // Pattern: plugins/<name>/tests/...
    // --passWithNoTests: è possibile che il plugin non abbia ancora test
    return {
      pattern: `plugins/${escapeRegex(args.plugin)}/tests/`,
      passWithNoTests: true
    };
  }

  if (args.themes) {
    // Pattern: themes/<qualsiasi>/tests/...
    // --passWithNoTests: in Fase 1 nessun tema ha ancora test, comando legittimo
    return {
      pattern: 'themes/[^/]+/tests/',
      passWithNoTests: true
    };
  }

  if (args.core) {
    // Pattern: tests/unit/... oppure tests/integration/... alla root
    // Deliberatamente ESCLUDE plugins/*/tests/ e themes/*/tests/
    // NO passWithNoTests: il core del progetto deve sempre avere test
    return {
      pattern: '^tests/(unit|integration)/',
      passWithNoTests: false
    };
  }

  fail('Errore interno: scope non gestito.');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runJest(scope, extraArgs) {
  const jestBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'jest');
  const jestArgs = [
    `--config=${JEST_CONFIG}`,
    `--testPathPatterns=${scope.pattern}`
  ];
  if (scope.passWithNoTests) jestArgs.push('--passWithNoTests');
  jestArgs.push(...extraArgs);

  console.log(`[testRunner] Esecuzione: jest --testPathPatterns='${scope.pattern}'`);

  const result = spawnSync(jestBin, jestArgs, {
    stdio: 'inherit',
    cwd: PROJECT_ROOT,
    env: process.env
  });

  if (result.error) {
    console.error('[testRunner] Errore durante l\'esecuzione di Jest:', result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scope = buildScope(args);
  runJest(scope, args.extraArgs);
}

main();
