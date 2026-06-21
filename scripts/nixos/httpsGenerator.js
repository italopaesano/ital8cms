'use strict';

/**
 * httpsGenerator.js
 *
 * Interactive generator for the NixOS HTTPS deployment of ital8cms.
 * Given a few inputs (domain, email, user/path, layout, challenge type) it
 * produces the `.nix` file(s) and the `https` block to paste into
 * `ital8Config.json5`, mirroring the recipes documented in
 * `docs/EXPLAIN-https.it.md` ("Messa in produzione su NixOS").
 *
 * Safety: it only writes to an output folder for the user to review — it never
 * touches `/etc/nixos` nor the live `ital8Config.json5`.
 *
 * The rendering functions are pure and exported, so they are unit-tested
 * (tests/unit/nixosHttpsGenerator.test.js) without going through the prompts.
 *
 * Run:  node scripts/nixos/httpsGenerator.js
 */

const fs = require('fs');
const path = require('path');

// ── Validation ────────────────────────────────────────────────────────────
const DOMAIN_RE = /^(?=.{1,253}$)([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_RE   = /^[a-z_][a-z0-9_-]*$/;

function isValidDomain(d) { return typeof d === 'string' && DOMAIN_RE.test(d); }
function isValidEmail(e)  { return typeof e === 'string' && EMAIL_RE.test(e); }
function isValidUser(u)   { return typeof u === 'string' && USER_RE.test(u); }
function isAbsolutePath(p) { return typeof p === 'string' && p.startsWith('/'); }

const WEBROOT = '/var/lib/acme-challenge';

// Service unit name per layout: A = login user, B = dedicated service user.
function serviceNameFor(layout) { return layout === 'A' ? 'ital8cms-web' : 'ital8cms'; }

function validateOpts(o) {
  const errors = [];
  if (!['A', 'B'].includes(o.layout))            errors.push('layout deve essere "A" o "B"');
  if (!['http01', 'dns01'].includes(o.challenge)) errors.push('challenge deve essere "http01" o "dns01"');
  if (!isValidDomain(o.domain))                  errors.push(`dominio non valido: ${o.domain}`);
  if (!isValidEmail(o.email))                    errors.push(`email non valida: ${o.email}`);
  if (!isAbsolutePath(o.projectRoot))            errors.push('projectRoot deve essere un percorso assoluto');
  if (o.layout === 'A' && !isValidUser(o.user))  errors.push(`utente non valido: ${o.user}`);
  if (o.challenge === 'dns01') {
    if (!o.dnsProvider)             errors.push('dnsProvider è richiesto per la challenge DNS-01');
    if (!isAbsolutePath(o.envFile)) errors.push('envFile (percorso assoluto) è richiesto per la challenge DNS-01');
  }
  if (errors.length) {
    const e = new Error('Input non validi:\n  - ' + errors.join('\n  - '));
    e.code = 'INVALID_OPTS';
    throw e;
  }
}

// ── Templates (pure) ────────────────────────────────────────────────────────
// NB: `\${pkgs.nodejs_22}` resta un'interpolazione Nix nel file generato;
// tutti gli altri `${...}` sono interpolazioni JavaScript (valori utente).

function renderWebServiceNix(o) {
  return `# ital8cms-web.nix — generato da scripts/nixos/httpsGenerator.js
# Web server ital8cms come servizio systemd: gira come utente di login, dalla home.
{ config, pkgs, ... }:
{
  systemd.services.ital8cms-web = {
    description = "ital8cms web server";
    after    = [ "network-online.target" ];
    wants    = [ "network-online.target" ];
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      Type = "simple";
      User = "${o.user}";
      WorkingDirectory = "${o.projectRoot}";
      ExecStart = "\${pkgs.nodejs_22}/bin/node ${o.projectRoot}/index.js";
      AmbientCapabilities   = [ "CAP_NET_BIND_SERVICE" ];  # bind su 80/443 da non-root
      CapabilityBoundingSet = [ "CAP_NET_BIND_SERVICE" ];
      SupplementaryGroups   = [ "acme" ];                  # per leggere /var/lib/acme/${o.domain}/key.pem
      Restart = "always";
      RestartSec = "10s";
      NoNewPrivileges = true;
      PrivateTmp = true;
      StandardOutput = "journal";
      StandardError  = "journal";
    };
  };

  networking.firewall.allowedTCPPorts = [ 80 443 ];
}
`;
}

function acmeCertBlock(o) {
  const lines = [];
  if (o.layout === 'B') lines.push('      group = "ital8cms";                 # il servizio legge key.pem via questo gruppo');
  if (o.challenge === 'http01') {
    lines.push(`      webroot = "${WEBROOT}";           # HTTP-01: niente DNS/token`);
  } else {
    lines.push(`      dnsProvider = "${o.dnsProvider}";`);
    lines.push(`      environmentFile = "${o.envFile}";   # es. CF_DNS_API_TOKEN=...`);
  }
  lines.push(`      reloadServices = [ "${serviceNameFor(o.layout)}.service" ];  # dopo emissione/rinnovo riavvia il servizio`);
  return lines.join('\n');
}

function renderHttpsNix(o) {
  const svc = serviceNameFor(o.layout);
  const challengeLabel = o.challenge === 'http01' ? 'HTTP-01' : 'DNS-01';
  const parts = [];

  parts.push('# ital8cms-https.nix — generato da scripts/nixos/httpsGenerator.js');
  parts.push(`# Certificato Let's Encrypt (${challengeLabel}) per ${o.domain}.`);
  parts.push('{ config, pkgs, ... }:');
  parts.push('{');

  if (o.layout === 'B') {
    parts.push(`  users.users.ital8cms = { isSystemUser = true; group = "ital8cms"; home = "${o.projectRoot}"; };`);
    parts.push('  users.groups.ital8cms = {};');
    parts.push('');
  }

  if (o.challenge === 'http01') {
    parts.push('  # Cartella condivisa per la challenge HTTP-01 (la scrive acme, la legge ital8cms).');
    parts.push('  systemd.tmpfiles.rules = [');
    parts.push('    "d /var/lib/acme-challenge 0755 acme acme - -"');
    parts.push('    "d /var/lib/acme-challenge/.well-known 0755 acme acme - -"');
    parts.push('    "d /var/lib/acme-challenge/.well-known/acme-challenge 0755 acme acme - -"');
    parts.push('  ];');
    parts.push('');
  }

  parts.push('  security.acme = {');
  parts.push('    acceptTerms = true;');
  parts.push(`    defaults.email = "${o.email}";`);
  parts.push(`    certs."${o.domain}" = {`);
  parts.push(acmeCertBlock(o));
  parts.push('    };');
  parts.push('  };');
  parts.push('');

  if (o.challenge === 'http01') {
    parts.push("  # lego valida via HTTP → il web server dev'essere GIÀ su :80 prima della validazione");
    parts.push(`  systemd.services."acme-${o.domain}" = {`);
    parts.push(`    after = [ "${svc}.service" ];`);
    parts.push(`    wants = [ "${svc}.service" ];`);
    parts.push('  };');
    parts.push('');
  }

  if (o.layout === 'B') {
    parts.push('  networking.firewall.allowedTCPPorts = [ 80 443 ];');
    parts.push('');
    parts.push('  systemd.services.ital8cms = {');
    parts.push('    description = "ital8cms";');
    parts.push('    wantedBy = [ "multi-user.target" ];');
    parts.push('    wants    = [ "network-online.target" ];');
    parts.push('    after    = [ "network-online.target" ];');
    parts.push('    environment.NODE_ENV = "production";');
    parts.push('    serviceConfig = {');
    parts.push('      User = "ital8cms";');
    parts.push('      Group = "ital8cms";');
    parts.push(`      WorkingDirectory = "${o.projectRoot}";`);
    parts.push('      ExecStart = "\${pkgs.nodejs_22}/bin/node index.js";');
    parts.push('      Restart = "on-failure";');
    parts.push('      AmbientCapabilities   = [ "CAP_NET_BIND_SERVICE" ];');
    parts.push('      CapabilityBoundingSet = [ "CAP_NET_BIND_SERVICE" ];');
    parts.push('      NoNewPrivileges = true;');
    parts.push('      ProtectSystem = "strict";');
    parts.push(`      ReadWritePaths = [ "${o.projectRoot}" ];`);
    parts.push('      ProtectHome = true;');
    parts.push('    };');
    parts.push('  };');
  }

  if (parts[parts.length - 1] === '') parts.pop();  // no trailing blank before the closing brace
  parts.push('}');
  return parts.join('\n') + '\n';
}

function renderItal8ConfigSnippet(o) {
  const acmeEnabled = o.challenge === 'http01';
  return `// Integra questo blocco in ital8Config.json5 (dentro ${o.projectRoot}).
"httpPort": 80,
"https": {
  "enabled": true,
  "port": 443,
  "AutoRedirectHttpPortToHttpsPort": true,
  "certFile": "/var/lib/acme/${o.domain}/fullchain.pem",
  "keyFile":  "/var/lib/acme/${o.domain}/key.pem",
  "caFile":   "",
  "hotReload": { "enabled": true, "debounceMs": 2000 },
  "acmeChallenge": { "enabled": ${acmeEnabled}, "webroot": "${acmeEnabled ? WEBROOT : ''}" }
}
`;
}

function renderInstructions(o) {
  const svc = serviceNameFor(o.layout);
  const nixFiles = o.layout === 'A'
    ? 'ital8cms-web.nix + ital8cms-https.nix'
    : 'ital8cms-https.nix';
  const lines = [];
  lines.push(`ital8cms — deploy HTTPS su NixOS (Opzione ${o.layout}, challenge ${o.challenge === 'http01' ? 'HTTP-01' : 'DNS-01'})`);
  lines.push('');
  lines.push(`File generati: ${nixFiles}, ital8Config.https.snippet.json5`);
  lines.push('');
  lines.push('Passi:');
  lines.push('1. Copia i file .nix in /etc/nixos/ (o una sottocartella) e aggiungili a');
  lines.push('   imports = [ ... ]; in configuration.nix.');
  lines.push(`2. Integra ital8Config.https.snippet.json5 nel tuo ${o.projectRoot}/ital8Config.json5.`);
  if (o.layout === 'B') {
    lines.push(`3. Porta il codice in ${o.projectRoot}, poi:`);
    lines.push(`     cd ${o.projectRoot} && sudo npm ci --omit=dev`);
    lines.push(`     sudo chown -R ital8cms:ital8cms ${o.projectRoot}`);
  } else {
    lines.push(`3. Assicurati che il codice sia in ${o.projectRoot} con le dipendenze:`);
    lines.push(`     cd ${o.projectRoot} && npm ci --omit=dev`);
  }
  lines.push('4. sudo nixos-rebuild switch');
  lines.push('');
  lines.push('Prerequisiti:');
  lines.push(`- record A di ${o.domain} → IP statico pubblico`);
  if (o.challenge === 'http01') {
    lines.push('- porta 80 raggiungibile da Internet (validazione HTTP-01)');
    lines.push('- niente altro già in ascolto su 80/443');
  } else {
    lines.push(`- credenziali DNS in ${o.envFile} (provider ${o.dnsProvider});`);
    lines.push('  il DNS del dominio dev\'essere gestito da quel provider');
  }
  lines.push('');
  lines.push('Verifica (dopo il rebuild):');
  lines.push(`  systemctl status ${svc}.service`);
  lines.push(`  systemctl status acme-${o.domain}.service`);
  lines.push(`  ls -l /var/lib/acme/${o.domain}/`);
  lines.push(`  curl -I http://${o.domain}    # atteso: 301 → https`);
  lines.push(`  curl -I https://${o.domain}   # atteso: 200`);
  return lines.join('\n') + '\n';
}

/**
 * Pure orchestration: validate the options and return the map of files to write.
 * @returns {{files: Object<string,string>}}
 */
function generateDeployment(opts) {
  validateOpts(opts);
  const files = {};
  if (opts.layout === 'A') files['ital8cms-web.nix'] = renderWebServiceNix(opts);
  files['ital8cms-https.nix'] = renderHttpsNix(opts);
  files['ital8Config.https.snippet.json5'] = renderItal8ConfigSnippet(opts);
  files['ISTRUZIONI.txt'] = renderInstructions(opts);
  return { files };
}

// ── Interactive CLI ─────────────────────────────────────────────────────────
async function promptOptions() {
  // inquirer v14: legacy interface under `.default`, list type renamed `select`.
  const inquirer = require('inquirer').default;

  const base = await inquirer.prompt([
    {
      type: 'select', name: 'layout', message: 'Layout del servizio:',
      choices: [
        { name: 'A — gira come utente di login, codice nella home (più semplice)', value: 'A' },
        { name: 'B — utente di servizio dedicato, codice in /var/lib (più isolato)', value: 'B' },
      ],
    },
    {
      type: 'select', name: 'challenge', message: 'Challenge Let\'s Encrypt:',
      choices: [
        { name: 'HTTP-01 (usa la porta 80; il più semplice)', value: 'http01' },
        { name: 'DNS-01 (niente porta 80; serve API DNS; supporta wildcard)', value: 'dns01' },
      ],
    },
    { type: 'input', name: 'domain', message: 'Dominio (es. example.com):', validate: v => isValidDomain(v) || 'dominio non valido' },
    { type: 'input', name: 'email',  message: 'Email per Let\'s Encrypt:',   validate: v => isValidEmail(v)  || 'email non valida' },
  ]);

  let extra;
  if (base.layout === 'A') {
    extra = await inquirer.prompt([
      { type: 'input', name: 'user', message: 'Utente di login che esegue il servizio:', validate: v => isValidUser(v) || 'username non valido' },
      { type: 'input', name: 'projectRoot', message: 'Percorso del progetto (nella home):', default: a => `/home/${a.user}/ital8cms-site`, validate: v => isAbsolutePath(v) || 'serve un percorso assoluto' },
    ]);
  } else {
    extra = await inquirer.prompt([
      { type: 'input', name: 'projectRoot', message: 'Percorso del progetto:', default: '/var/lib/ital8cms', validate: v => isAbsolutePath(v) || 'serve un percorso assoluto' },
    ]);
  }

  let dns = {};
  if (base.challenge === 'dns01') {
    dns = await inquirer.prompt([
      { type: 'input', name: 'dnsProvider', message: 'Provider DNS (lego, es. cloudflare):', default: 'cloudflare', validate: v => !!v || 'richiesto' },
      { type: 'input', name: 'envFile', message: 'File con le credenziali DNS:', default: '/var/lib/secrets/acme.env', validate: v => isAbsolutePath(v) || 'serve un percorso assoluto' },
    ]);
  }

  const out = await inquirer.prompt([
    { type: 'input', name: 'outDir', message: 'Cartella di output:', default: './nixos-out' },
  ]);

  return { ...base, ...extra, ...dns, outDir: out.outDir };
}

async function main() {
  console.log('ital8cms — generatore deploy HTTPS per NixOS\n');
  const opts = await promptOptions();
  const { files } = generateDeployment(opts);

  fs.mkdirSync(opts.outDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(opts.outDir, name);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('  scritto: ' + filePath);
  }
  console.log(`\nFatto. Rivedi i file in ${opts.outDir} e segui ISTRUZIONI.txt.`);
  console.log('Nessun file di sistema è stato modificato.');
}

if (require.main === module) {
  main().catch(err => { console.error('[httpsGenerator] ' + err.message); process.exit(1); });
}

module.exports = {
  isValidDomain, isValidEmail, isValidUser, isAbsolutePath,
  serviceNameFor, validateOpts, generateDeployment,
  renderWebServiceNix, renderHttpsNix, renderItal8ConfigSnippet, renderInstructions,
};
