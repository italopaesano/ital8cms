/**
 * fixtureLoader.js
 *
 * Carica fixtures JSON5 condivise da /core/testHelpers/fixtures/.
 * Per fixtures locali di un plugin, usare direttamente loadJson5 con path
 * relativo alla cartella tests/fixtures/ del plugin.
 */

const path = require('path');
const loadJson5 = require('../loadJson5');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

/**
 * Carica una fixture JSON5 condivisa.
 *
 * @param {string} name - Nome della fixture (con o senza estensione .json5).
 *                        Es: 'userAccount' o 'userAccount.json5' o 'subdir/foo.json5'
 * @returns {*} Contenuto parsato della fixture
 * @throws {Error} Se il nome è invalido o il file non esiste
 */
function loadFixture(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('loadFixture: il parametro "name" deve essere una stringa non vuota');
  }

  const normalized = name.replace(/^\/+/, '');
  const withExt = /\.[a-z0-9]+$/i.test(normalized) ? normalized : `${normalized}.json5`;
  const fixturePath = path.join(FIXTURES_DIR, withExt);

  return loadJson5(fixturePath);
}

module.exports = { loadFixture };
