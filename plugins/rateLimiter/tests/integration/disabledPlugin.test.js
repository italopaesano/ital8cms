/**
 * Test d'integrazione: con custom.enabled = false il plugin è inerte.
 * - getObjectToShareToOthersPlugin → null (i consumer saltano il guard con `if (rl)`)
 * - getMiddlewareToAdd → [] (nessun enforcement)
 *
 * File separato per avere un module registry fresco di main.js (engine = null).
 */

'use strict';

const { createPluginSandbox, createPluginSysMock } = require('../../../../core/testHelpers');

let sandbox;
let plugin;

beforeAll(async () => {
  sandbox = createPluginSandbox('rateLimiter', {
    pluginConfig: {
      active: 1,
      isInstalled: 1,
      custom: {
        enabled: false,
        defaults: {
          findWindowSeconds: 900,
          maxFailures: 5,
          shortBlockSeconds: 300,
          maxShortBlocks: 5,
          longBlockSeconds: 86400,
          escalationResetSeconds: 86400,
        },
      },
    },
  });
  sandbox.writeJson5('protectedRoutes.json5', { rules: [{ name: 'adminLogin' }] });

  plugin = require('../../main.js');
  await plugin.loadPlugin(createPluginSysMock(), sandbox.path);
});

afterAll(() => {
  if (sandbox) sandbox.cleanup();
});

test('getObjectToShareToOthersPlugin restituisce null quando disabilitato', () => {
  expect(plugin.getObjectToShareToOthersPlugin('adminUsers')).toBeNull();
});

test('getMiddlewareToAdd restituisce un array vuoto quando disabilitato', () => {
  expect(plugin.getMiddlewareToAdd({})).toEqual([]);
});
