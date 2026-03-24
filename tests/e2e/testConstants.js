/**
 * Costanti condivise per i test E2E
 *
 * Definisce utenti di test, password e URL utilizzati nei test.
 * Gli utenti vengono creati da globalSetup.js e rimossi da globalTeardown.js.
 */

const TEST_PASSWORD = 'TestPass123!';

// Prefisso per utenti di test (facilita identificazione e cleanup)
const TEST_USER_PREFIX = '__test';

const TEST_USERS = {
  root: {
    username: '__testRoot',
    email: 'testroot@test.ital8cms.dev',
    roleIds: [0]
  },
  admin: {
    username: '__testAdmin',
    email: 'testadmin@test.ital8cms.dev',
    roleIds: [1]
  },
  editor: {
    username: '__testEditor',
    email: 'testeditor@test.ital8cms.dev',
    roleIds: [2]
  },
  selfEditor: {
    username: '__testSelfEditor',
    email: 'testselfeditor@test.ital8cms.dev',
    roleIds: [3]
  }
};

const URLS = {
  // Authentication pages
  loginPage: '/pluginPages/adminUsers/login.ejs',
  logoutPage: '/pluginPages/adminUsers/logout.ejs',

  // Authentication API endpoints
  loginApi: '/api/adminUsers/login',
  logoutApi: '/api/adminUsers/logout',
  loggedApi: '/api/adminUsers/logged',

  // Admin-only API endpoints (require role 0 or 1)
  userListApi: '/api/adminUsers/userList',
  userInfoApi: '/api/adminUsers/userInfo',
  roleListApi: '/api/adminUsers/roleList',

  // Admin pages (require role 0 or 1 via accessControl)
  adminDashboard: '/admin/',
  adminUsersSection: '/admin/usersManagment/index.ejs',

  // Public pages
  homepage: '/',

  // Reserved paths (adminUsers middleware, require login)
  reservedPage: '/reserved/',
  privatePage: '/private/',
  libPage: '/lib/',

  // Protected pages (accessControl custom rules)
  userProfile: '/pluginPages/adminUsers/userProfile.ejs',

  // Access denied page
  accessDenied: '/pluginPages/adminAccessControl/access-denied.ejs'
};

// Porta HTTP dedicata per i test E2E standard (evita conflitti con server di sviluppo su 3000)
// Il globalSetup sovrascrive httpPort in ital8Config.json5 con questo valore.
// Playwright si connette a questa porta per eseguire i test.
const E2E_TEST_HTTP_PORT = 19400;

// Constants for globalPrefix E2E tests (used by playwright.globalPrefix.config.js and globalPrefixSetup.js)
const GLOBAL_PREFIX_TEST = {
  prefix: '/testprefix',
  httpPort: 19300,
};

// Path alla directory www dedicata ai test (relativa alla root del progetto)
// I test E2E NON devono mai dipendere dai file in /www/ di produzione.
// Tutti i file necessari ai test devono essere in /tests/fixtures/www/
const TEST_WWW_PATH = '/tests/fixtures/www';

module.exports = {
  TEST_PASSWORD,
  TEST_USER_PREFIX,
  TEST_USERS,
  URLS,
  E2E_TEST_HTTP_PORT,
  GLOBAL_PREFIX_TEST,
  TEST_WWW_PATH
};
