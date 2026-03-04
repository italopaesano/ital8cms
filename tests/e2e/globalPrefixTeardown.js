/**
 * Playwright Global Teardown for globalPrefix tests
 *
 * Eseguito DOPO tutti i test con globalPrefix.
 *
 * 1. Ripristina userAccount.json5 (delega a globalTeardown.js standard)
 * 2. Ripristina ital8Config.json5 dal backup creato in globalPrefixSetup.js
 */

const fs = require('fs');
const path = require('path');

const defaultGlobalTeardown = require('./globalTeardown');

const CONFIG_PATH = path.join(__dirname, '../../ital8Config.json5');
const BACKUP_PATH = CONFIG_PATH + '.prefix-bak';

module.exports = async function globalPrefixTeardown() {
  // 1. Restore test users (reuse existing globalTeardown logic)
  await defaultGlobalTeardown();

  // 2. Restore original ital8Config.json5
  if (fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(BACKUP_PATH, CONFIG_PATH);
    fs.unlinkSync(BACKUP_PATH);
    console.log('[Prefix Teardown] ital8Config.json5 restored from backup');
  } else {
    console.warn('[Prefix Teardown] WARNING: No config backup found, ital8Config.json5 may be modified');
  }
};
