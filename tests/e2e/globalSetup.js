/**
 * Playwright Global Setup
 *
 * Eseguito PRIMA dell'avvio del server e dei test E2E.
 * Aggiunge utenti di test al file userAccount.json5 con password hashate tramite bcrypt.
 * Il file originale viene salvato come backup (.bak) per il ripristino in globalTeardown.
 */

const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const json5 = require('json5');

const { TEST_PASSWORD, TEST_USERS } = require('./testConstants');

const USER_ACCOUNT_PATH = path.join(__dirname, '../../plugins/adminUsers/userAccount.json5');

module.exports = async function globalSetup() {
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
