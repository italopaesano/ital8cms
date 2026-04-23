/**
 * middlewareRunner.js
 *
 * Esegue un middleware Koa isolato contro un ctx mock e una next() configurabile.
 */

/**
 * Esegue un middleware Koa.
 *
 * @param {Function} middleware - Middleware async (ctx, next) => {}
 * @param {Object} ctx - Context mock (tipicamente da createCtxMock)
 * @param {Function} [next] - next() function. Se omessa, viene creata come jest.fn() risolta.
 * @returns {Promise<{ctx: Object, next: Function}>} Oggetto con ctx finale e riferimento a next
 *   (next è jest.fn() se non fornito, permettendo asserzioni su expect(next).toHaveBeenCalled())
 */
async function runMiddleware(middleware, ctx, next) {
  if (typeof middleware !== 'function') {
    throw new Error('runMiddleware: middleware must be a function');
  }
  if (!ctx || typeof ctx !== 'object') {
    throw new Error('runMiddleware: ctx must be an object');
  }
  const nextFn = next || jest.fn(async () => {});
  await middleware(ctx, nextFn);
  return { ctx, next: nextFn };
}

module.exports = { runMiddleware };
