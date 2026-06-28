/**
 * Playwright webServer launcher — applica la config di test PRIMA di avviare il server.
 *
 * Perché serve: Playwright (1.61) avvia il `webServer` e ne **attende l'url PRIMA**
 * di eseguire `globalSetup`. Se la config di test (porta dedicata, temi di test,
 * wwwPath, utenti) viene applicata da `globalSetup`, il server boota con la config
 * NON patchata (porta 3000) e l'attesa di Playwright su `localhost:<porta E2E>` va
 * in **timeout** (chicken-and-egg). Applicando la config qui — prima di
 * `require('index.js')` — il server parte già con la config di test, così l'url
 * atteso da Playwright è subito disponibile.
 *
 * Questo launcher è usato come `webServer.command` nei config Playwright al posto di
 * `node index.js`; di conseguenza i config NON usano più `globalSetup` (la logica di
 * setup è invocata qui). I `globalTeardown` restano e ripristinano i backup.
 *
 * Mode (env `E2E_MODE`): `main` (default) → `globalSetup`; `prefix` → `globalPrefixSetup`.
 * Fresh-clone safe: materializza i vivi (ital8Config/userAccount) dai `.default` se mancanti.
 */

'use strict';

const path = require('path');
const materializeFromDefault = require('../../core/materializeFromDefault');

const ROOT = path.join(__dirname, '..', '..');

async function main() {
  // Fresh-clone safe: i config vivi che il setup legge/patcha potrebbero non esistere
  // ancora (git-ignored, materializzati al boot). Materializzali dai .default.
  await materializeFromDefault(
    path.join(ROOT, 'ital8Config.default.json5'),
    path.join(ROOT, 'ital8Config.json5'),
  );
  await materializeFromDefault(
    path.join(ROOT, 'plugins/adminUsers/userAccount.default.json5'),
    path.join(ROOT, 'plugins/adminUsers/userAccount.json5'),
  );

  // Applica la config di test (porta, temi, wwwPath, https off, utenti) PRIMA del boot.
  const mode = process.env.E2E_MODE === 'prefix' ? 'prefix' : 'main';
  const applyTestSetup = mode === 'prefix' ? require('./globalPrefixSetup') : require('./globalSetup');
  await applyTestSetup();

  // Avvia il server: index.js boota leggendo la config ora patchata.
  require('../../index.js');
}

main().catch((err) => {
  console.error('[e2e startWebServer] errore:', err && err.message ? err.message : err);
  process.exit(1);
});
