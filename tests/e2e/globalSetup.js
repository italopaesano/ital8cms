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

const editJson5 = require('../../core/editJson5');
const { TEST_PASSWORD, TEST_USERS, TEST_WWW_PATH, E2E_TEST_HTTP_PORT } = require('./testConstants');

const USER_ACCOUNT_PATH = path.join(__dirname, '../../plugins/adminUsers/userAccount.json5');
const CONFIG_PATH = path.join(__dirname, '../../ital8Config.json5');

module.exports = async function globalSetup() {
  // ── Override configurazione: isola il server E2E da quello di sviluppo ──
  console.log('[Test Setup] Overriding ital8Config.json5 for E2E testing...');

  const configBackupPath = CONFIG_PATH + '.test-bak';

  // Stale-backup detection: se esiste già un backup, il run precedente è
  // crashato senza far girare il teardown. Ripristina dal backup PRIMA di
  // procedere, così partiamo sempre da uno stato pulito.
  if (fs.existsSync(configBackupPath)) {
    console.warn('[Test Setup] Stale config backup detected — restoring from backup before proceeding');
    fs.copyFileSync(configBackupPath, CONFIG_PATH);
    fs.unlinkSync(configBackupPath);
  }

  const originalConfigContent = fs.readFileSync(CONFIG_PATH, 'utf8');
  fs.writeFileSync(configBackupPath, originalConfigContent, 'utf8');

  // Apply override edits via editJson5 — this preserves comments, formatting,
  // and trailing commas of every part of ital8Config.json5 NOT being modified,
  // including the nested https block (comments inside it survive thanks to
  // the array-path API which surgically targets only the `enabled` leaf).
  await editJson5(CONFIG_PATH, 'activeTheme', 'themeForTesting');
  await editJson5(CONFIG_PATH, 'adminActiveTheme', 'themeForTestingAdmin');
  await editJson5(CONFIG_PATH, 'wwwPath', TEST_WWW_PATH);
  await editJson5(CONFIG_PATH, 'httpPort', E2E_TEST_HTTP_PORT);

  // Disable HTTPS: nested-path edit (preserves all comments inside `https`).
  // editJson5 throws if the path doesn't exist; check the parsed object first
  // so config files without an https block don't break the setup.
  const currentConfig = json5.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (currentConfig.https && Object.prototype.hasOwnProperty.call(currentConfig.https, 'enabled')) {
    await editJson5(CONFIG_PATH, ['https', 'enabled'], false);
  }

  console.log(`[Test Setup] Themes: themeForTesting / themeForTestingAdmin`);
  console.log(`[Test Setup] wwwPath: ${TEST_WWW_PATH}`);
  console.log(`[Test Setup] httpPort: ${E2E_TEST_HTTP_PORT}`);
  console.log(`[Test Setup] HTTPS: disabled`);
  console.log(`[Test Setup] Config backup: ${configBackupPath}`);

  // ── Aggiungi utenti di test ──
  console.log('[Test Setup] Adding test users to userAccount.json5...');

  const backupPath = USER_ACCOUNT_PATH + '.test-bak';

  // Stale-backup detection: se esiste già un backup, il run precedente non
  // ha fatto teardown. Ripristina prima di procedere.
  if (fs.existsSync(backupPath)) {
    console.warn('[Test Setup] Stale userAccount backup detected — restoring from backup before proceeding');
    fs.copyFileSync(backupPath, USER_ACCOUNT_PATH);
    fs.unlinkSync(backupPath);
  }

  // Read current file content
  const originalContent = fs.readFileSync(USER_ACCOUNT_PATH, 'utf8');
  const usersData = json5.parse(originalContent);

  // Backup original file (will be restored in globalTeardown)
  fs.writeFileSync(backupPath, originalContent, 'utf8');

  // Generate bcrypt hash for test password
  const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);

  // Build merged users map (existing + test users)
  const mergedUsers = { ...usersData.users };
  for (const userData of Object.values(TEST_USERS)) {
    mergedUsers[userData.username] = {
      email: userData.email,
      hashPassword: hashedPassword,
      roleIds: userData.roleIds
    };
  }

  // Replace the whole "users" block via editJson5: preserves the file's
  // outer comments (header) and the file's overall structure.
  await editJson5(USER_ACCOUNT_PATH, 'users', mergedUsers);

  const userCount = Object.keys(TEST_USERS).length;
  console.log(`[Test Setup] ${userCount} test users added successfully`);
  console.log(`[Test Setup] Backup saved to ${backupPath}`);
};
