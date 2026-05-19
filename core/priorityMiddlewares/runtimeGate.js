const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

function isExemptPath(reqPath, adminPrefix, adminThemeResourcesPrefix, globalPrefix) {
  const base = globalPrefix || '';
  if (adminPrefix && reqPath.startsWith(`${base}/${adminPrefix}`)) return true;
  if (adminThemeResourcesPrefix && reqPath.startsWith(`${base}/${adminThemeResourcesPrefix}`)) return true;
  return false;
}

function createMaintenanceGate(options) {
  const {
    ital8Conf,
    projectRoot,
    initialState = 'running',
  } = options;

  let publicState = initialState;

  const adminPrefix = ital8Conf.adminPrefix || 'admin';
  const adminThemeResourcesPrefix = ital8Conf.adminThemeResourcesPrefix || 'admin-theme-resources';
  const globalPrefix = ital8Conf.globalPrefix || '';

  const maintenanceConf = ital8Conf.maintenance || {};
  const rawPagePath = maintenanceConf.pagePath || './core/maintenancePage.ejs';
  const pagePath = path.isAbsolute(rawPagePath) ? rawPagePath : path.resolve(projectRoot, rawPagePath);
  const retryAfter = Number.isFinite(maintenanceConf.retryAfterSeconds) ? maintenanceConf.retryAfterSeconds : 600;

  async function renderMaintenance(ctx) {
    let html;
    try {
      html = await ejs.renderFile(pagePath, {
        retryAfterSeconds: retryAfter,
        ctx,
      });
    } catch (err) {
      console.warn(`[maintenanceGate] errore rendering ${pagePath}: ${err.message}`);
      html = '<!DOCTYPE html><meta charset="utf-8"><title>Torniamo subito</title>' +
             '<h1>Torniamo subito</h1><p>Il sito è temporaneamente non disponibile.</p>';
    }
    ctx.status = 503;
    ctx.set('Retry-After', String(retryAfter));
    ctx.set('X-Robots-Tag', 'noindex');
    ctx.type = 'text/html; charset=utf-8';
    ctx.body = html;
  }

  async function middleware(ctx, next) {
    if (publicState === 'running') return next();
    if (isExemptPath(ctx.path, adminPrefix, adminThemeResourcesPrefix, globalPrefix)) {
      return next();
    }
    await renderMaintenance(ctx);
  }

  return {
    middleware,
    setState(newState) {
      if (newState !== 'running' && newState !== 'stopped') {
        throw new Error(`maintenanceGate: stato non valido ${newState}`);
      }
      publicState = newState;
    },
    getState() { return publicState; },
  };
}

module.exports = { createMaintenanceGate, isExemptPath };
