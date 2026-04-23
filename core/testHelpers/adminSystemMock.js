/**
 * adminSystemMock.js
 *
 * Factory per creare un mock dell'AdminSystem usabile nei test di plugin admin
 * e di rendering di admin pages.
 */

/**
 * Crea un mock dell'AdminSystem.
 *
 * @param {Object} [options={}]
 * @param {Object} [options.ui] Valore restituito da getUI()
 * @param {Array}  [options.menuSections=[]] Valore restituito da getMenuSections()
 * @param {Object} [options.services={}] Mappa serviceName → plugin object
 * @param {Object} [options.endpoints={}] Valore restituito da getEndpointsForPassData()
 * @returns {Object} Mock dell'AdminSystem
 */
function createAdminSystemMock(options = {}) {
  const ui = options.ui || {
    title: 'Admin',
    welcomeMessage: 'Welcome',
    theme: 'defaultAdminTheme'
  };
  const menuSections = options.menuSections || [];
  const services = options.services || {};
  const endpoints = options.endpoints || {};

  return {
    getUI: jest.fn(() => ui),
    getMenuSections: jest.fn(() => menuSections),
    getService: jest.fn((name) => services[name] || null),
    getEndpointsForPassData: jest.fn(() => endpoints),
    setPluginSys: jest.fn(),
    initialize: jest.fn(),
    onAdminPluginLoaded: jest.fn()
  };
}

module.exports = { createAdminSystemMock };
