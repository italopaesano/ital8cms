'use strict';

// Unit tests for the NixOS HTTPS deploy generator (scripts/nixos/httpsGenerator.js).
// They exercise the pure rendering/validation functions (no prompts) and act as
// an anti-drift guard against the recipes in docs/EXPLAIN-https.it.md.

const gen = require('../../scripts/nixos/httpsGenerator');

describe('nixos httpsGenerator — validators', () => {
  test('domain', () => {
    expect(gen.isValidDomain('example.com')).toBe(true);
    expect(gen.isValidDomain('sub.example.co.uk')).toBe(true);
    expect(gen.isValidDomain('bad domain')).toBe(false);
    expect(gen.isValidDomain('nodot')).toBe(false);
  });
  test('email', () => {
    expect(gen.isValidEmail('you@example.com')).toBe(true);
    expect(gen.isValidEmail('nope')).toBe(false);
  });
  test('user / absolute path', () => {
    expect(gen.isValidUser('web')).toBe(true);
    expect(gen.isValidUser('1bad')).toBe(false);
    expect(gen.isAbsolutePath('/var/lib/ital8cms')).toBe(true);
    expect(gen.isAbsolutePath('relative/path')).toBe(false);
  });
});

describe('nixos httpsGenerator — Opzione A + HTTP-01', () => {
  const { files } = gen.generateDeployment({
    layout: 'A', challenge: 'http01',
    domain: 'example.com', email: 'you@example.com',
    user: 'web', projectRoot: '/home/web/site',
  });

  test('genera due .nix + snippet + istruzioni', () => {
    expect(Object.keys(files).sort()).toEqual([
      'ISTRUZIONI.txt',
      'ital8Config.https.snippet.json5',
      'ital8cms-https.nix',
      'ital8cms-web.nix',
    ]);
  });

  test('web service: utente, capability, gruppo acme, nodejs_22 letterale', () => {
    const web = files['ital8cms-web.nix'];
    expect(web).toContain('User = "web";');
    expect(web).toContain('CAP_NET_BIND_SERVICE');
    expect(web).toContain('SupplementaryGroups   = [ "acme" ];');
    // l'interpolazione Nix deve restare letterale nel file generato
    expect(web).toContain('${pkgs.nodejs_22}/bin/node /home/web/site/index.js');
  });

  test('https.nix: webroot, ordine acme, reload del web service', () => {
    const nix = files['ital8cms-https.nix'];
    expect(nix).toContain('systemd.tmpfiles.rules');
    expect(nix).toContain('webroot = "/var/lib/acme-challenge";');
    expect(nix).toContain('reloadServices = [ "ital8cms-web.service" ];');
    expect(nix).toContain('systemd.services."acme-example.com"');
    expect(nix).not.toContain('dnsProvider');
  });

  test('snippet ital8Config: percorsi cert e acmeChallenge attivo', () => {
    const snip = files['ital8Config.https.snippet.json5'];
    expect(snip).toContain('"certFile": "/var/lib/acme/example.com/fullchain.pem"');
    expect(snip).toContain('"keyFile":  "/var/lib/acme/example.com/key.pem"');
    expect(snip).toContain('"acmeChallenge": { "enabled": true, "webroot": "/var/lib/acme-challenge" }');
  });
});

describe('nixos httpsGenerator — Opzione B + DNS-01', () => {
  const { files } = gen.generateDeployment({
    layout: 'B', challenge: 'dns01',
    domain: 'example.org', email: 'you@example.org',
    projectRoot: '/var/lib/ital8cms',
    dnsProvider: 'cloudflare', envFile: '/var/lib/secrets/acme.env',
  });

  test('genera un solo .nix all-in-one (+ snippet + istruzioni)', () => {
    expect(Object.keys(files).sort()).toEqual([
      'ISTRUZIONI.txt',
      'ital8Config.https.snippet.json5',
      'ital8cms-https.nix',
    ]);
  });

  test('https.nix: utente dedicato, dnsProvider, niente webroot/ordine HTTP-01, hardening', () => {
    const nix = files['ital8cms-https.nix'];
    expect(nix).toContain('users.users.ital8cms');
    expect(nix).toContain('group = "ital8cms";');
    expect(nix).toContain('dnsProvider = "cloudflare";');
    expect(nix).toContain('environmentFile = "/var/lib/secrets/acme.env";');
    expect(nix).toContain('systemd.services.ital8cms =');
    expect(nix).toContain('ProtectSystem = "strict";');
    expect(nix).not.toContain('tmpfiles');           // DNS-01: nessuna cartella challenge
    expect(nix).not.toContain('acme-example.org');    // DNS-01: nessun ordine HTTP-01
  });

  test('snippet ital8Config: acmeChallenge disattivo', () => {
    expect(files['ital8Config.https.snippet.json5'])
      .toContain('"acmeChallenge": { "enabled": false, "webroot": "" }');
  });
});

describe('nixos httpsGenerator — input non validi', () => {
  test('dominio non valido → throw', () => {
    expect(() => gen.generateDeployment({
      layout: 'A', challenge: 'http01', domain: 'bad domain',
      email: 'you@example.com', user: 'web', projectRoot: '/home/web/site',
    })).toThrow(/Input non validi/);
  });
  test('DNS-01 senza dnsProvider → throw', () => {
    expect(() => gen.generateDeployment({
      layout: 'B', challenge: 'dns01', domain: 'example.com',
      email: 'you@example.com', projectRoot: '/var/lib/ital8cms',
      dnsProvider: '', envFile: '/var/lib/secrets/acme.env',
    })).toThrow(/dnsProvider/);
  });
});
