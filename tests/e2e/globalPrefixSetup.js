/**
 * Playwright Global Setup for globalPrefix tests
 *
 * Eseguito PRIMA dell'avvio del server per i test con globalPrefix non vuoto.
 *
 * 1. Backup di ital8Config.json5
 * 2. Modifica config: globalPrefix, httpPort, disabilita HTTPS
 * 3. Aggiunta utenti di test (delega a globalSetup.js standard)
 *
 * Il file originale viene ripristinato in globalPrefixTeardown.js.
 */

const fs = require('fs');
const path = require('path');
const json5 = require('json5');

const editJson5 = require('../../core/editJson5');
const defaultGlobalSetup = require('./globalSetup');
const { GLOBAL_PREFIX_TEST, TEST_WWW_PATH } = require('./testConstants');

const CONFIG_PATH = path.join(__dirname, '../../ital8Config.json5');
const BACKUP_PATH = CONFIG_PATH + '.prefix-bak';

module.exports = async function globalPrefixSetup() {
  const { prefix, httpPort } = GLOBAL_PREFIX_TEST;

  console.log(`[Prefix Setup] Configuring server with globalPrefix: "${prefix}" on port ${httpPort}...`);

  // Stale-backup detection: se esiste già un backup, il run precedente non
  // ha fatto teardown (crash, kill, ecc.). Ripristina prima di procedere.
  if (fs.existsSync(BACKUP_PATH)) {
    console.warn('[Prefix Setup] Stale config backup detected — restoring from backup before proceeding');
    fs.copyFileSync(BACKUP_PATH, CONFIG_PATH);
    fs.unlinkSync(BACKUP_PATH);
  }

  // 1. Back up original ital8Config.json5
  const originalContent = fs.readFileSync(CONFIG_PATH, 'utf8');
  fs.writeFileSync(BACKUP_PATH, originalContent, 'utf8');

  // 2. Apply edits via editJson5 — preserves comments/formatting of every
  // part of the config NOT touched. Top-level scalars edit cleanly; the
  // nested https.enabled is handled by replacing the whole "https" block.
  await editJson5(CONFIG_PATH, 'globalPrefix', prefix);
  await editJson5(CONFIG_PATH, 'httpPort', httpPort);
  await editJson5(CONFIG_PATH, 'wwwPath', TEST_WWW_PATH);

  const currentConfig = json5.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (currentConfig.https) {
    await editJson5(CONFIG_PATH, 'https', { ...currentConfig.https, enabled: false });
  }
  console.log(`[Prefix Setup] Config modified: globalPrefix="${prefix}", httpPort=${httpPort}, https=disabled, wwwPath=${TEST_WWW_PATH}`);

  // 3. Add test users (reuse existing globalSetup logic)
  await defaultGlobalSetup();
};
