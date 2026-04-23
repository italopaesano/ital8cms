/**
 * ctxMock.js
 *
 * Factory per creare un mock del context Koa usabile nei test di handler di rotta,
 * middleware e page hooks.
 */

/**
 * Crea un mock del context Koa.
 *
 * @param {Object} [options={}] Configurazione del mock
 * @param {string} [options.method='GET']
 * @param {string} [options.path='/']
 * @param {string} [options.url]
 * @param {string} [options.href]
 * @param {Object} [options.query={}] Query string params
 * @param {Object} [options.params={}] Route params
 * @param {Object} [options.headers={}] Request headers
 * @param {*}      [options.body] Corpo della richiesta (ctx.request.body)
 * @param {Object|null} [options.session=null] Sessione Koa
 * @param {Object} [options.state={}] ctx.state
 * @returns {Object} Mock di ctx con metodi jest.fn() per asserzioni
 */
function createCtxMock(options = {}) {
  const method = options.method || 'GET';
  const reqPath = options.path || '/';
  const url = options.url || reqPath;
  const href = options.href || `http://localhost:3000${reqPath}`;
  const query = { ...(options.query || {}) };
  const headers = { ...(options.headers || {}) };

  const ctx = {
    method,
    path: reqPath,
    url,
    href,
    host: options.host || 'localhost:3000',
    hostname: options.hostname || 'localhost',
    protocol: options.protocol || 'http',
    query,
    params: { ...(options.params || {}) },
    headers,
    request: {
      method,
      path: reqPath,
      url,
      href,
      query,
      headers,
      body: options.body !== undefined ? options.body : undefined
    },
    response: {
      headers: {},
      status: 200,
      body: undefined,
      type: undefined
    },
    state: { ...(options.state || {}) },
    session: options.session !== undefined ? options.session : null,
    body: undefined,
    status: 200,
    type: undefined,

    // Record delle operazioni per asserzioni
    _redirects: [],
    _setHeaders: {},
    _throws: []
  };

  ctx.set = jest.fn(function setHeader(nameOrObj, value) {
    if (nameOrObj && typeof nameOrObj === 'object') {
      Object.assign(ctx._setHeaders, nameOrObj);
      Object.assign(ctx.response.headers, nameOrObj);
    } else {
      ctx._setHeaders[nameOrObj] = value;
      ctx.response.headers[nameOrObj] = value;
    }
  });

  ctx.get = jest.fn((name) => {
    if (!name) return undefined;
    const lower = name.toLowerCase();
    const match = Object.keys(headers).find((k) => k.toLowerCase() === lower);
    return match ? headers[match] : undefined;
  });

  ctx.redirect = jest.fn((targetUrl) => {
    ctx._redirects.push(targetUrl);
    ctx.status = 302;
  });

  ctx.throw = jest.fn((status, message) => {
    const err = new Error(message || 'Error');
    err.status = typeof status === 'number' ? status : 500;
    if (typeof status !== 'number') err.message = status;
    ctx._throws.push({ status: err.status, message: err.message });
    throw err;
  });

  return ctx;
}

module.exports = { createCtxMock };
