// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Suite di integrità di questo tema.
 *
 * Il contratto che ogni tema deve soddisfare è uno solo, quindi le asserzioni
 * vivono in `core/testHelpers/themeIntegrity.js` — accanto agli altri helper
 * condivisi — mentre il file resta dentro il tema: è il modello self-contained
 * del progetto (un tema clonato porta con sé il proprio test), ed è ciò che
 * `npm run test:themes` cerca con il suo pattern `themes/[^/]+/tests/`.
 *
 * Il nome del tema NON è scritto qui: si ricava da `__dirname`. Rinominare la
 * cartella non lascia quindi un test che ne valida un altro.
 */

const { describeThemeIntegrity } = require('../../../core/testHelpers/themeIntegrity');

describeThemeIntegrity(__dirname);
