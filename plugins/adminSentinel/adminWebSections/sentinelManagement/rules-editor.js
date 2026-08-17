/**
 * rules-editor.js — Vista B: editor JSON5 grezzo di sentinelRules.json5.
 *
 * Il testo viene salvato **così com'è**: la validazione controlla, non
 * riformatta. Se il salvataggio passasse da parse → stringify sparirebbero
 * commenti, indentazione e ordine delle chiavi — e in questo file i commenti
 * sono la descrizione di cosa osserva ogni regola.
 */

/* global SN_API, snT, escapeHtml */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (v) => escapeHtml(v === null || v === undefined ? '' : String(v));

  /**
   * Etichetta tradotta. L'implementazione sta in `sentinel-i18n.js`, condivisa
   * dalle quattro pagine della sezione.
   *
   * Si risolve alla CHIAMATA e non al caricamento per due motivi: sotto Node
   * questo file viene richiesto per le sue funzioni pure, dove nessun global di
   * browser esiste; e se lo script condiviso non fosse stato caricato, l'ultima
   * cosa utile che una dashboard può fare è mostrare le chiavi invece di
   * spegnersi a metà rendering.
   */
  const t = (key, vars) => (typeof snT === 'function' ? snT(key, vars) : String(key));

  let savedContent = '';
  // mtime del file quando l'abbiamo caricato. Si rimanda al salvataggio: è così
  // che il server si accorge che qualcuno l'ha toccato mentre lo si modificava.
  let knownMtime = null;

  function setAlert(message, kind) {
    const box = $('globalAlert');
    box.className = 'alert alert-' + kind;
    box.textContent = message;
    box.classList.remove('d-none');
  }

  function clearAlert() {
    $('globalAlert').classList.add('d-none');
  }

  function markDirty() {
    const dirty = $('rulesEditor').value !== savedContent;
    $('dirtyBadge').classList.toggle('d-none', !dirty);
    // Il salvataggio resta disponibile solo dopo una validazione riuscita:
    // impedisce di mettere in produzione un file mai controllato.
    if (dirty) $('btnSave').disabled = true;
  }

  function renderValidation(result) {
    const box = $('validationResult');
    const parts = [];

    if (result.ok) {
      parts.push('<div class="text-success fw-bold">'
        + esc(t('valid', { n: result.ruleCount })) + '</div>');
    } else {
      parts.push('<div class="text-danger fw-bold">' + esc(t('invalid')) + '</div>');
    }

    if (result.errors && result.errors.length) {
      parts.push('<div class="mt-2 fw-bold text-danger">' + esc(t('errorsTitle')) + '</div><ul class="mb-0 ps-3">'
        + result.errors.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul>');
    }
    // Gli avvisi non impediscono il salvataggio ma vanno letti: «questa regola
    // non scatterà mai» è il tipo di cosa che si scopre altrimenti fra un mese.
    if (result.warnings && result.warnings.length) {
      parts.push('<div class="mt-2 fw-bold text-warning">' + esc(t('warningsTitle')) + '</div><ul class="mb-0 ps-3">'
        + result.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>');
    }

    box.innerHTML = parts.join('');
    $('btnSave').disabled = !result.ok;
  }

  function renderBackups(backups) {
    const list = $('backupList');
    if (!backups || backups.length === 0) {
      list.innerHTML = '<li class="list-group-item text-muted">' + esc(t('noBackups')) + '</li>';
      return;
    }
    list.innerHTML = backups.slice(0, 10).map((b) =>
      '<li class="list-group-item d-flex justify-content-between">'
      + '<code class="text-truncate">' + esc(b.file) + '</code>'
      + '<span class="text-muted ms-2">' + esc(new Date(b.mtime).toLocaleString()) + '</span>'
      + '</li>').join('');
  }

  async function load() {
    clearAlert();
    try {
      const res = await fetch(SN_API + '/rules/raw', { credentials: 'same-origin' });
      const data = await res.json();

      if (!data.enabled) {
        setAlert(t('inactive'), 'warning');
        $('rulesEditor').disabled = true;
        return;
      }
      if (!data.ok) {
        setAlert(t('readFailed', { error: data.error }), 'danger');
        return;
      }

      savedContent = data.content;
      knownMtime = data.mtime || null;
      $('rulesEditor').value = data.content;
      renderBackups(data.backups);
      markDirty();
    } catch (err) {
      setAlert(t('networkError', { error: err.message }), 'danger');
    }
  }

  async function validate() {
    clearAlert();
    try {
      const res = await fetch(SN_API + '/rules/validate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: $('rulesEditor').value }),
      });
      renderValidation(await res.json());
    } catch (err) {
      setAlert(t('networkError', { error: err.message }), 'danger');
    }
  }

  /**
   * @param {boolean} [force] - salva anche se il file è cambiato nel frattempo
   */
  async function save(force) {
    clearAlert();
    try {
      const corpo = { content: $('rulesEditor').value };
      // Omettere il campo È la rinuncia alla guardia: la precondizione è
      // opzionale lato server, come `If-Match`.
      if (!force && knownMtime) corpo.knownMtime = knownMtime;

      const res = await fetch(SN_API + '/rules/save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const data = await res.json();

      // Il file è cambiato da quando l'abbiamo caricato. Qui si sta per
      // riscrivere il file INTERO, quindi sovrascrivere significa cancellare
      // quella modifica per intero: si nomina la conseguenza invece di
      // limitarsi a chiedere conferma.
      if (res.status === 409) {
        const procedi = window.confirm(
          t('conflict', { error: data.error || t('conflictFallback') }));
        if (procedi) await save(true);
        else setAlert(t('saveCancelled'), 'warning');
        return;
      }

      if (!data.saved) {
        // Due esiti diversi che prima finivano nello stesso posto. Un file di
        // regole invalido è colpa di chi scrive e si corregge nell'editor; un
        // disco pieno o una cartella non scrivibile no — e mostrarlo come
        // «non valido» senza un errore mandava a cercare nel posto sbagliato.
        const validazione = Array.isArray(data.errors) && data.errors.length > 0;
        if (validazione) {
          renderValidation(data);
          setAlert(t('saveRejected'), 'danger');
        } else {
          setAlert(t('writeFailed', { error: data.error || t('noReason') }), 'danger');
        }
        return;
      }

      savedContent = $('rulesEditor').value;
      markDirty();
      // reloadRules() è già stato chiamato dal server: le regole sono in vigore
      // adesso, senza riavvio.
      setAlert(t('saved', { n: data.ruleCount })
        + (data.backup ? t('savedBackup', { file: data.backup }) : ''), 'success');
      load();
    } catch (err) {
      setAlert(t('networkError', { error: err.message }), 'danger');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('rulesEditor').addEventListener('input', markDirty);
    $('btnReload').addEventListener('click', load);
    $('btnValidate').addEventListener('click', validate);
    // `click` passa un evento come primo argomento: senza involucro finirebbe
    // in `force`, e ogni salvataggio scavalcherebbe la guardia sul file.
    $('btnSave').addEventListener('click', function () { save(false); });

    // Uscire con modifiche non salvate è un incidente frequente e silenzioso.
    window.addEventListener('beforeunload', (e) => {
      if ($('rulesEditor').value !== savedContent) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    load();
  });
})();
