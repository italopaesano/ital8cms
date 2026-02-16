/**
 * Playwright Global Teardown
 *
 * Eseguito DOPO tutti i test E2E.
 * Ripristina il file userAccount.json5 originale dal backup creato in globalSetup.
 */

const fs = require('fs');
const path = require('path');

const USER_ACCOUNT_PATH = path.join(__dirname, '../../plugins/adminUsers/userAccount.json5');

module.exports = async function globalTeardown() {
  const backupPath = USER_ACCOUNT_PATH + '.test-bak';

  if (fs.existsSync(backupPath)) {
    // Restore original file from backup
    fs.copyFileSync(backupPath, USER_ACCOUNT_PATH);
    fs.unlinkSync(backupPath);
    console.log('[Test Teardown] userAccount.json5 restored from backup');
  } else {
    console.warn('[Test Teardown] WARNING: No backup file found, userAccount.json5 may contain test users');
  }
};
