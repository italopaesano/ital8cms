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

const defaultGlobalSetup = require('./globalSetup');
const { GLOBAL_PREFIX_TEST, TEST_WWW_PATH } = require('./testConstants');

const CONFIG_PATH = path.join(__dirname, '../../ital8Config.json5');
const BACKUP_PATH = CONFIG_PATH + '.prefix-bak';

module.exports = async function globalPrefixSetup() {
  const { prefix, httpPort } = GLOBAL_PREFIX_TEST;

  console.log(`[Prefix Setup] Configuring server with globalPrefix: "${prefix}" on port ${httpPort}...`);

  // 1. Back up original ital8Config.json5
  const originalContent = fs.readFileSync(CONFIG_PATH, 'utf8');
  fs.writeFileSync(BACKUP_PATH, originalContent, 'utf8');

  // 2. Parse and modify config
  const config = json5.parse(originalContent);
  config.globalPrefix = prefix;
  config.httpPort = httpPort;

  // Disable HTTPS to simplify prefix testing (prefix tests focus on routing, not TLS)
  if (config.https) {
    config.https.enabled = false;
  }

  // Override wwwPath to use test www directory (isolation from production www/)
  config.wwwPath = TEST_WWW_PATH;

  // 3. Write modified config
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  console.log(`[Prefix Setup] Config modified: globalPrefix="${prefix}", httpPort=${httpPort}, https=disabled, wwwPath=${TEST_WWW_PATH}`);

  // 4. Add test users (reuse existing globalSetup logic)
  await defaultGlobalSetup();
};
