#!/usr/bin/env node

/**
 * checkNixShell.js
 *
 * Verifica che i test vengano avviati all'interno di nix-shell.
 * Se il sistema ha Nix installato ma l'utente è fuori da nix-shell,
 * lo script interrompe l'esecuzione con un messaggio chiaro e le istruzioni.
 *
 * Logica:
 *  1. IN_NIX_SHELL impostato          → siamo dentro nix-shell → OK
 *  2. /nix assente e nix non trovato  → sistema non-Nix → OK (procedi normalmente)
 *  3. Nix presente ma non in shell    → ERRORE con istruzioni
 */

'use strict';

const fs = require('fs');
const { execSync } = require('child_process');

// Colori ANSI per output terminale
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
};

/**
 * Controlla se siamo attualmente dentro nix-shell.
 * La variabile IN_NIX_SHELL viene impostata automaticamente da nix-shell
 * con il valore "impure" o "pure".
 */
function isInsideNixShell() {
  return !!process.env.IN_NIX_SHELL;
}

/**
 * Controlla se il sistema ha Nix installato.
 * Verifica la presenza della directory /nix (standard su NixOS e Nix multi-user)
 * oppure la disponibilità del comando nix nel PATH.
 */
function isNixAvailable() {
  if (fs.existsSync('/nix')) {
    return true;
  }
  try {
    execSync('nix --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// --- Logica principale ---

const insideNixShell = isInsideNixShell();
const nixAvailable   = isNixAvailable();

if (insideNixShell) {
  console.log(
    `${c.green}✓ nix-shell attivo` +
    ` (IN_NIX_SHELL=${process.env.IN_NIX_SHELL})${c.reset}`
  );
  process.exit(0);
}

if (!nixAvailable) {
  console.log(
    `${c.cyan}ℹ  Sistema non-Nix rilevato, procedo con i test normalmente.${c.reset}`
  );
  process.exit(0);
}

// Nix è disponibile ma non siamo dentro nix-shell → avvisa e interrompi
console.error(`
${c.red}${c.bold}✗  ERRORE: nix-shell non attivo${c.reset}

${c.yellow}Sei su un sistema Nix ma stai eseguendo i test fuori da nix-shell.${c.reset}

I test (in particolare Playwright) richiedono dipendenze di sistema
(librerie browser, glib, gtk3, ecc.) che sono disponibili ${c.bold}solo${c.reset}
all'interno dell'ambiente definito in ${c.cyan}shell.nix${c.reset}.

${c.bold}Per eseguire i test correttamente:${c.reset}

  ${c.cyan}1. Entra in nix-shell:${c.reset}
     ${c.bold}nix-shell${c.reset}

  ${c.cyan}2. Poi esegui i test:${c.reset}
     ${c.bold}npm test${c.reset}

${c.yellow}Oppure in un solo comando:${c.reset}
     ${c.bold}nix-shell --run "npm test"${c.reset}

`);

process.exit(1);
