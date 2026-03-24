/**
 * Playwright Global Setup
 *
 * Eseguito PRIMA dell'avvio del server e dei test E2E.
 *
 * 1. Override ital8Config.json5:
 *    - wwwPath → /tests/www (isolamento da /www/ di produzione)
 *    - httpPort → porta dedicata E2E (evita conflitti con server di sviluppo)
 *    - HTTPS disabilitato (i test E2E verificano routing, non TLS)
 *    - Temi di test (themeForTesting / themeForTestingAdmin)
 *
 * 2. Aggiunta utenti di test con password hashate tramite bcrypt
 *
 * I file originali vengono salvati come backup (.test-bak) e ripristinati
 * in globalTeardown.js.
 */

const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const json5 = require('json5');

const { TEST_PASSWORD, TEST_USERS, TEST_WWW_PATH, E2E_TEST_HTTP_PORT } = require('./testConstants');

const USER_ACCOUNT_PATH = path.join(__dirname, '../../plugins/adminUsers/userAccount.json5');
const CONFIG_PATH = path.join(__dirname, '../../ital8Config.json5');

module.exports = async function globalSetup() {
  // ── Override configurazione: isola il server E2E da quello di sviluppo ──
  console.log('[Test Setup] Overriding ital8Config.json5 for E2E testing...');

  const originalConfigContent = fs.readFileSync(CONFIG_PATH, 'utf8');
  const configBackupPath = CONFIG_PATH + '.test-bak';
  fs.writeFileSync(configBackupPath, originalConfigContent, 'utf8');

  const configData = json5.parse(originalConfigContent);

  // Temi dedicati ai test
  configData.activeTheme = 'themeForTesting';
  configData.adminActiveTheme = 'themeForTestingAdmin';

  // Directory www di test (isolamento dalla /www/ di produzione)
  configData.wwwPath = TEST_WWW_PATH;

  // Porta HTTP dedicata (evita conflitti con un eventuale server di sviluppo sulla 3000)
  configData.httpPort = E2E_TEST_HTTP_PORT;

  // Disabilita HTTPS (i test E2E verificano routing e funzionalità, non TLS)
  if (configData.https) {
    configData.https.enabled = false;
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(configData, null, 2), 'utf8');

  console.log(`[Test Setup] Themes: themeForTesting / themeForTestingAdmin`);
  console.log(`[Test Setup] wwwPath: ${TEST_WWW_PATH}`);
  console.log(`[Test Setup] httpPort: ${E2E_TEST_HTTP_PORT}`);
  console.log(`[Test Setup] HTTPS: disabled`);
  console.log(`[Test Setup] Config backup: ${configBackupPath}`);

  // ── Aggiungi utenti di test ──
  console.log('[Test Setup] Adding test users to userAccount.json5...');

  // Read current file content
  const originalContent = fs.readFileSync(USER_ACCOUNT_PATH, 'utf8');
  const usersData = json5.parse(originalContent);

  // Backup original file (will be restored in globalTeardown)
  const backupPath = USER_ACCOUNT_PATH + '.test-bak';
  fs.writeFileSync(backupPath, originalContent, 'utf8');

  // Generate bcrypt hash for test password
  const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);

  // Add test users
  for (const [, userData] of Object.entries(TEST_USERS)) {
    usersData.users[userData.username] = {
      email: userData.email,
      hashPassword: hashedPassword,
      roleIds: userData.roleIds
    };
  }

  // Write updated file (JSON format - comments stripped but that's OK since we restore from backup)
  fs.writeFileSync(USER_ACCOUNT_PATH, JSON.stringify(usersData, null, 2), 'utf8');

  const userCount = Object.keys(TEST_USERS).length;
  console.log(`[Test Setup] ${userCount} test users added successfully`);
  console.log(`[Test Setup] Backup saved to ${backupPath}`);
};
