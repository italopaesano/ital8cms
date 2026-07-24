/**
 * updateEngine — primitive per l'aggiornamento di ital8cms da una release GitHub.
 *
 * Strategia APPLY: **B (git)** + rete di sicurezza stile C.
 *   git fetch --tags && git checkout <tag> allinea i file TRACCIATI alla release
 *   (gestisce add/rename/delete) e NON tocca i file untracked/ignored (dati
 *   utente, config vivi, media, node_modules, plugin installati a mano).
 *
 * Discovery via `git` (non l'API GitHub): git eredita già il proxy dell'ambiente
 * e l'apply è comunque git — un solo canale, zero dipendenze HTTP.
 *
 * I tag non-semver (es. `v0.0.1-beta-3`, col trattino) sono ESCLUSI dal calcolo
 * della "latest" ma segnalati: dalle release con tag semver-puliti (`v0.0.1-beta.4`)
 * l'auto-discovery è affidabile; nel frattempo si usa `--tag` esplicito.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const semver = require('semver');

function git(projectRoot, args, opts = {}) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', opts.inheritErr ? 'inherit' : 'pipe'],
    encoding: 'utf8',
  }).trim();
}

function isGitRepo(projectRoot) {
  return fs.existsSync(path.join(projectRoot, '.git'));
}

function gitAvailable() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; }
  catch (_) { return false; }
}

/** URL del remote origin (per il link alle release). */
function remoteUrl(projectRoot) {
  try { return git(projectRoot, ['remote', 'get-url', 'origin']); }
  catch (_) { return null; }
}

/** owner/repo dedotti dall'URL del remote (https o ssh). */
function ownerRepo(projectRoot) {
  const url = remoteUrl(projectRoot);
  if (!url) return null;
  const m = url.match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** Versione corrente da package.json. */
function currentVersion(projectRoot) {
  try { return JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version || null; }
  catch (_) { return null; }
}

/**
 * tag → versione semver per il CONFRONTO (il tag originale resta per il checkout).
 * Strip 'v' e normalizza la convenzione prerelease "parola-numero" → "parola.numero"
 * (es. `beta-3` → `beta.3`): entrambe sono semver valide, ma `beta-3` (un solo
 * identificatore) ordinerebbe SOPRA `beta.4` in ASCII. Normalizzando, i tag storici
 * (col trattino) e quelli nuovi (col punto) ordinano coerentemente. null se non-semver.
 */
function versionFromTag(tag) {
  let v = tag.replace(/^v/, '');
  v = v.replace(/-(alpha|beta|rc|pre|dev)-(\d+)/gi, '-$1.$2');
  return semver.valid(v) ? v : null;
}

/** Elenca i tag del remote via git ls-remote (non serve un fetch completo). */
function listRemoteTags(projectRoot) {
  const out = git(projectRoot, ['ls-remote', '--tags', '--refs', 'origin']);
  if (!out) return [];
  return out.split('\n').map((line) => {
    const parts = line.split('\t');
    return parts[1] ? parts[1].replace('refs/tags/', '') : null;
  }).filter(Boolean);
}

/**
 * Logica PURA di selezione (testabile senza git): dalla lista dei tag e dalla
 * versione corrente calcola la release target semver più recente.
 * @param {string[]} allTags
 * @param {string|null} current
 * @returns {{target:({tag,version}|null), isNewer:boolean, skipped:string[]}}
 */
function selectLatest(allTags, current) {
  const valid = [];
  const skipped = [];
  for (const t of allTags) {
    const v = versionFromTag(t);
    if (v) valid.push({ tag: t, version: v });
    else skipped.push(t);
  }
  if (valid.length === 0) return { target: null, isNewer: false, skipped };
  valid.sort((a, b) => semver.rcompare(a.version, b.version));
  const latest = valid[0];
  const isNewer = current ? semver.gt(latest.version, current) : true;
  return { target: latest, isNewer, skipped };
}

/**
 * Discovery: confronta la versione corrente con la latest semver disponibile.
 * @returns {{current, target:({tag,version}|null), isNewer:boolean, skipped:string[], allTags:string[]}}
 */
function discover(projectRoot, opts = {}) {
  const current = currentVersion(projectRoot);
  const allTags = listRemoteTags(projectRoot);

  // --tag esplicito: nessun confronto, si punta a quel tag (se esiste).
  if (opts.tag) {
    const exists = allTags.includes(opts.tag) || allTags.includes(`v${opts.tag}`);
    const tag = allTags.includes(opts.tag) ? opts.tag : (allTags.includes(`v${opts.tag}`) ? `v${opts.tag}` : opts.tag);
    return { current, target: { tag, version: versionFromTag(tag) }, isNewer: true, explicit: true, exists, skipped: [], allTags };
  }

  const sel = selectLatest(allTags, current);
  return { current, target: sel.target, isNewer: sel.isNewer, skipped: sel.skipped, allTags };
}

/** Stato dei file TRACCIATI: pulito o con modifiche locali (gli untracked NON contano). */
function trackedTreeStatus(projectRoot) {
  // --untracked-files=no: ignora i file non tracciati (dati utente, config vivi).
  const out = git(projectRoot, ['status', '--porcelain', '--untracked-files=no']);
  const dirty = out ? out.split('\n').filter(Boolean) : [];
  return { clean: dirty.length === 0, dirtyFiles: dirty };
}

/** Ref corrente (sha) per il rollback. */
function currentRef(projectRoot) {
  return git(projectRoot, ['rev-parse', 'HEAD']);
}

function fetchTags(projectRoot) {
  git(projectRoot, ['fetch', '--tags', '--force', 'origin'], { inheritErr: true });
}

/** Checkout di un ref (tag/sha) in detached HEAD. */
function checkout(projectRoot, ref) {
  // Guard: un ref che inizia con '-' (o vuoto) verrebbe interpretato da git come
  // un'opzione. I tag arrivano da ls-remote o da --tag: rifiuta i valori ambigui.
  if (typeof ref !== 'string' || ref.length === 0 || ref.startsWith('-')) {
    throw new Error(`ref non valido per il checkout: ${JSON.stringify(ref)}`);
  }
  git(projectRoot, ['checkout', '--detach', ref], { inheritErr: true });
}

module.exports = {
  git,
  isGitRepo,
  gitAvailable,
  remoteUrl,
  ownerRepo,
  currentVersion,
  versionFromTag,
  listRemoteTags,
  selectLatest,
  discover,
  trackedTreeStatus,
  currentRef,
  fetchTags,
  checkout,
};
