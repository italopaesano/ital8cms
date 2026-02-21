// This file follows the JSON5 standard - comments and trailing commas are supported
'use strict';

/**
 * httpsManager.js
 *
 * Gestisce l'intero ciclo di vita dei server HTTP/HTTPS di ital8cms:
 *   - Analisi certificato TLS all'avvio (scadenza, soglie warning/critical)
 *   - Avvio server HTTP e/o HTTPS in base alla configurazione
 *   - Hot reload certificati senza riavvio (fs.watch + setSecureContext)
 *   - Endpoint ACME HTTP-01 challenge per rinnovo Let's Encrypt
 *
 * Esportazione:
 *   start(app, router, ital8Conf)  — funzione principale, chiamata da index.js
 */

const http             = require('http');
const https            = require('https');
const fs               = require('fs');
const path             = require('path');
const { X509Certificate } = require('crypto');

const PROJECT_ROOT = path.join(__dirname, '..');


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ANALISI CERTIFICATO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Estrae il valore CN da una stringa Distinguished Name.
 * Gestisce sia il formato "\n" che "," come separatore (varia per versione Node.js).
 * @param {string} dnString - es. "CN=example.com\nO=Let's Encrypt\nC=US"
 * @returns {string}
 */
function extractCN(dnString) {
  const parts = dnString.split(/[,\n]/);
  const cnPart = parts.find(p => p.trim().startsWith('CN='));
  return cnPart ? cnPart.trim().replace('CN=', '').trim() : dnString;
}

/**
 * Analizza il certificato TLS e logga informazioni su soggetto, emittente e scadenza.
 * Emette warning o errore critico se il certificato è prossimo alla scadenza.
 * In caso di errore di lettura/parsing, logga un warning e continua.
 *
 * @param {string} certPath - Percorso assoluto al file certificato (.pem)
 * @param {object} ital8Conf - Configurazione principale ital8cms
 */
function analyzeCert(certPath, ital8Conf) {
  try {
    const certData = fs.readFileSync(certPath);
    const cert     = new X509Certificate(certData);

    const expiryDate  = new Date(cert.validTo);
    const now         = new Date();
    const daysLeft    = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));
    const dateStr     = expiryDate.toISOString().split('T')[0];

    const subjectCN   = extractCN(cert.subject);
    const issuerCN    = extractCN(cert.issuer);
    const isSelfSigned = cert.subject === cert.issuer;

    const warningDays  = ital8Conf.https?.expiryWarningDays  ?? 60;
    const criticalDays = ital8Conf.https?.expiryCriticalDays ?? 15;

    console.log('[HTTPS] ─────────────────────────────────────────');
    console.log(`[HTTPS] Certificato: ${subjectCN}`);
    console.log(`[HTTPS] Emittente:   ${issuerCN}`);
    if (isSelfSigned) {
      console.log('[HTTPS] ⓘ  Certificato self-signed (sviluppo locale)');
    }
    console.log(`[HTTPS] Scade il:    ${dateStr} (tra ${daysLeft} giorni)`);

    if (daysLeft <= 0) {
      console.error(`[HTTPS] 🔴 CRITICAL: certificato SCADUTO da ${Math.abs(daysLeft)} giorni → eseguire: certbot renew`);
    } else if (daysLeft <= criticalDays) {
      console.error(`[HTTPS] 🔴 CRITICAL: scade tra ${daysLeft} giorni (soglia critica: ${criticalDays}) → eseguire SUBITO: certbot renew`);
    } else if (daysLeft <= warningDays) {
      console.warn(`[HTTPS]  ⚠  WARNING: scade tra ${daysLeft} giorni (soglia: ${warningDays}) → eseguire: certbot renew`);
    } else {
      console.log('[HTTPS] ✓  Certificato OK');
    }
    console.log('[HTTPS] ─────────────────────────────────────────');

  } catch (err) {
    console.warn(`[HTTPS] ⚠  Impossibile analizzare il certificato: ${err.message}`);
  }
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HOT RELOAD CERTIFICATI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Attiva il monitoraggio dei file certificato con fs.watch().
 * Quando un file cambia, attende debounceMs prima di ricaricare per evitare
 * reload su scritture parziali (certbot scrive fullchain.pem e privkey.pem
 * in due operazioni separate).
 * Dopo il reload logga la nuova data di scadenza del certificato.
 *
 * @param {import('https').Server} httpsServer - Server HTTPS su cui chiamare setSecureContext
 * @param {string} certPath - Percorso assoluto al file certificato
 * @param {string} keyPath  - Percorso assoluto al file chiave privata
 * @param {string|null} caPath - Percorso assoluto alla CA intermedia (null se assente)
 * @param {object} ital8Conf  - Configurazione principale ital8cms
 */
function setupHotReload(httpsServer, certPath, keyPath, caPath, ital8Conf) {
  const debounceMs = ital8Conf.https?.hotReload?.debounceMs ?? 2000;
  let debounceTimer = null;

  const reloadCerts = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        const newContext = {
          cert: fs.readFileSync(certPath),
          key:  fs.readFileSync(keyPath),
        };
        if (caPath) newContext.ca = fs.readFileSync(caPath);

        httpsServer.setSecureContext(newContext);
        console.log('[HTTPS] Certificato ricaricato (hot reload)');
        analyzeCert(certPath, ital8Conf);
      } catch (err) {
        console.error(`[HTTPS] Errore hot reload certificato: ${err.message}`);
      }
    }, debounceMs);
  };

  fs.watch(certPath, reloadCerts);
  if (caPath) fs.watch(caPath, reloadCerts);

  console.log(`[HTTPS] Hot reload attivo — debounce: ${debounceMs}ms`);
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ACME HTTP-01 CHALLENGE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Restituisce il percorso assoluto alla directory dei token ACME challenge.
 * La struttura è: {webroot}/.well-known/acme-challenge/
 * Compatibile con certbot --webroot -w {webroot}.
 *
 * @param {object} ital8Conf
 * @returns {string|null} Percorso assoluto, o null se acmeChallenge non configurato
 */
function getChallengeDir(ital8Conf) {
  const webroot = ital8Conf.https?.acmeChallenge?.webroot;
  if (!webroot) return null;
  return path.resolve(PROJECT_ROOT, webroot, '.well-known', 'acme-challenge');
}

/**
 * Registra la route ACME challenge nel router Koa.
 * Deve essere chiamata prima delle istanze koa-classic-server in index.js
 * per garantire la priorità (il router Koa viene eseguito prima di koa-classic-server).
 *
 * Path fisso (RFC 8555): GET /.well-known/acme-challenge/:token
 *
 * Se la directory dei token non esiste viene creata automaticamente con un warning.
 * Se webroot non è configurato l'endpoint viene disabilitato con un warning.
 *
 * @param {import('@koa/router')} router - Router Koa (@koa/router)
 * @param {object} ital8Conf
 */
function setupAcmeChallengeRoute(router, ital8Conf) {
  if (!ital8Conf.https?.acmeChallenge?.enabled) return;

  const webroot = ital8Conf.https.acmeChallenge.webroot;
  if (!webroot) {
    console.warn('[HTTPS] acmeChallenge.enabled = true ma webroot non configurato → endpoint ACME disabilitato');
    return;
  }

  const challengeDir = getChallengeDir(ital8Conf);

  // Auto-crea la directory se non esiste (certbot la crea lui, ma meglio essere pronti)
  if (!fs.existsSync(challengeDir)) {
    fs.mkdirSync(challengeDir, { recursive: true });
    console.warn(`[HTTPS] ⚠  Directory ACME challenge creata automaticamente: ${challengeDir}`);
  }

  router.get('/.well-known/acme-challenge/:token', (ctx) => {
    // path.basename previene path traversal (es. token = "../../etc/passwd")
    const safeToken = path.basename(ctx.params.token);
    const tokenPath = path.join(challengeDir, safeToken);

    if (fs.existsSync(tokenPath)) {
      ctx.type = 'text/plain';
      ctx.body = fs.readFileSync(tokenPath, 'utf8');
    } else {
      ctx.status = 404;
      ctx.body   = 'Token not found';
    }
  });

  console.log(`[HTTPS] ACME challenge: /.well-known/acme-challenge/:token → ${challengeDir}`);
}

/**
 * Crea il server HTTP minimale che redirige su HTTPS (301).
 * Se acmeChallenge è abilitato, le richieste al path ACME vengono servite
 * direttamente (prima del redirect) per permettere il rinnovo del certificato.
 *
 * @param {number} httpsPort  - Porta HTTPS di destinazione del redirect
 * @param {object} ital8Conf
 * @returns {import('http').Server}
 */
function createHttpRedirectServer(httpsPort, ital8Conf) {
  const portSuffix       = httpsPort === 443 ? '' : ':' + httpsPort;
  const challengeDir     = getChallengeDir(ital8Conf);
  const acmeEnabled      = ital8Conf.https?.acmeChallenge?.enabled && challengeDir;

  return http.createServer((req, res) => {

    // ACME challenge ha priorità assoluta sul redirect 301
    if (acmeEnabled && req.url.startsWith('/.well-known/acme-challenge/')) {
      const safeToken = path.basename(req.url); // previene path traversal
      const tokenPath = path.join(challengeDir, safeToken);

      if (fs.existsSync(tokenPath)) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(fs.readFileSync(tokenPath, 'utf8'));
        return;
      }
    }

    // Redirect 301 HTTP → HTTPS
    const hostname = (req.headers.host || 'localhost').split(':')[0];
    res.writeHead(301, { 'Location': 'https://' + hostname + portSuffix + req.url });
    res.end();
  });
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FUNZIONE PRINCIPALE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Avvia l'infrastruttura server HTTP/HTTPS di ital8cms.
 * Sostituisce il blocco START/END HTTP/HTTPS SERVER SETUP di index.js.
 *
 * Scenari gestiti:
 *   1. https.enabled = false          → HTTP puro su httpPort
 *   2. https.enabled = true (cert OK) → HTTPS su https.port
 *       + AutoRedirectHttpPortToHttpsPort = true  → HTTP su httpPort redirige 301 a HTTPS
 *       + AutoRedirectHttpPortToHttpsPort = false → HTTP su httpPort serve l'app completa
 *   3. https.enabled = true (cert KO) → console.error + fallback a HTTP puro su httpPort
 *
 * Funzionalità aggiuntive (configurabili in ital8Config.json5):
 *   - Analisi certificato TLS all'avvio (scadenza, warning, critical)
 *   - Hot reload certificati senza riavvio
 *   - Endpoint ACME HTTP-01 challenge per rinnovo Let's Encrypt
 *
 * @param {import('koa')} app          - Istanza Koa
 * @param {import('@koa/router')} router - Router Koa (priority middleware)
 * @param {object} ital8Conf           - Configurazione principale ital8cms
 */
function start(app, router, ital8Conf) {

  // Registra la route ACME challenge nel router (prioritaria su koa-classic-server)
  setupAcmeChallengeRoute(router, ital8Conf);

  if (ital8Conf.https && ital8Conf.https.enabled) {

    // ── Risoluzione percorsi certificati ─────────────────────────────────────
    const certPath = path.resolve(PROJECT_ROOT, ital8Conf.https.certFile);
    const keyPath  = path.resolve(PROJECT_ROOT, ital8Conf.https.keyFile);
    const caPath   = ital8Conf.https.caFile
      ? path.resolve(PROJECT_ROOT, ital8Conf.https.caFile)
      : null;

    // ── Caricamento certificati TLS ───────────────────────────────────────────
    let tlsConfig = null;
    try {
      tlsConfig = {
        ...(ital8Conf.https.tlsOptions || {}),
        cert: fs.readFileSync(certPath),
        key:  fs.readFileSync(keyPath),
      };
      if (caPath) tlsConfig.ca = fs.readFileSync(caPath);
    } catch (certError) {
      console.error('[HTTPS] Errore nel caricamento dei certificati: ' + certError.message);
      console.error('[HTTPS] Fallback: avvio in HTTP puro sulla porta ' + ital8Conf.httpPort);
      http.createServer(app.callback()).listen(ital8Conf.httpPort, () => {
        console.log('server started on port: ' + ital8Conf.httpPort + '  (HTTP - HTTPS fallback per cert mancanti)');
      });
      return;
    }

    // ── Analisi certificato (solo se caricato con successo) ───────────────────
    analyzeCert(certPath, ital8Conf);

    // ── Avvio server HTTPS ────────────────────────────────────────────────────
    const httpsServer = https.createServer(tlsConfig, app.callback());
    httpsServer.listen(ital8Conf.https.port, () => {
      console.log('server started on HTTPS port: ' + ital8Conf.https.port);
    });

    // ── Hot reload certificati ────────────────────────────────────────────────
    if (ital8Conf.https.hotReload && ital8Conf.https.hotReload.enabled) {
      setupHotReload(httpsServer, certPath, keyPath, caPath, ital8Conf);
    }

    // ── Server HTTP ───────────────────────────────────────────────────────────
    if (ital8Conf.https.AutoRedirectHttpPortToHttpsPort) {
      // Server HTTP minimale: redirect 301 → HTTPS (con gestione ACME challenge)
      createHttpRedirectServer(ital8Conf.https.port, ital8Conf)
        .listen(ital8Conf.httpPort, () => {
          console.log('HTTP port ' + ital8Conf.httpPort + ' → redirect 301 to HTTPS port ' + ital8Conf.https.port);
        });
    } else {
      // Server HTTP completo in parallelo all'HTTPS
      http.createServer(app.callback()).listen(ital8Conf.httpPort, () => {
        console.log('server started on HTTP port: ' + ital8Conf.httpPort);
      });
    }

  } else {

    // ── HTTPS disabilitato: HTTP puro (comportamento originale) ───────────────
    http.createServer(app.callback()).listen(ital8Conf.httpPort, () => {
      console.log('server started on port: ' + ital8Conf.httpPort);
    });
  }
}


module.exports = { start };
