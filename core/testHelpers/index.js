/**
 * /core/testHelpers/index.js
 *
 * Entry point per gli helper di test condivisi. Permette import sintetico:
 *
 *   const {
 *     createCtxMock,
 *     createPluginSysMock,
 *     runRoute
 *   } = require('../../core/testHelpers');
 */

module.exports = {
  ...require('./fixtureLoader'),
  ...require('./ctxMock'),
  ...require('./themeSysMock'),
  ...require('./adminSystemMock'),
  ...require('./pluginSysMock'),
  ...require('./middlewareRunner'),
  ...require('./routeRunner'),
  ...require('./hooksPageRunner'),
  ...require('./pluginSandbox')
};
