/**
 * rules-editor.js — Vista B: editor JSON5 grezzo di sentinelRules.json5.
 *
 * Il testo viene salvato **così com'è**: la validazione controlla, non
 * riformatta. Se il salvataggio passasse da parse → stringify sparirebbero
 * commenti, indentazione e ordine delle chiavi — e in questo file i commenti
 * sono la descrizione di cosa osserva ogni regola.
 */

/* global SN_API, escapeHtml */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (v) => escapeHtml(v === null || v === undefined ? '' : String(v));

  let savedContent = '';

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
      parts.push('<div class="text-success fw-bold">✓ Valido — '
        + esc(result.ruleCount) + ' regole</div>');
    } else {
      parts.push('<div class="text-danger fw-bold">✗ Non valido</div>');
    }

    if (result.errors && result.errors.length) {
      parts.push('<div class="mt-2 fw-bold text-danger">Errori</div><ul class="mb-0 ps-3">'
        + result.errors.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul>');
    }
    // Gli avvisi non impediscono il salvataggio ma vanno letti: «questa regola
    // non scatterà mai» è il tipo di cosa che si scopre altrimenti fra un mese.
    if (result.warnings && result.warnings.length) {
      parts.push('<div class="mt-2 fw-bold text-warning">Avvisi</div><ul class="mb-0 ps-3">'
        + result.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>');
    }

    box.innerHTML = parts.join('');
    $('btnSave').disabled = !result.ok;
  }

  function renderBackups(backups) {
    const list = $('backupList');
    if (!backups || backups.length === 0) {
      list.innerHTML = '<li class="list-group-item text-muted">Nessuno.</li>';
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
        setAlert('Il plugin sentinel non è attivo: non c\'è nulla da modificare.', 'warning');
        $('rulesEditor').disabled = true;
        return;
      }
      if (!data.ok) {
        setAlert('Lettura del file fallita: ' + data.error, 'danger');
        return;
      }

      savedContent = data.content;
      $('rulesEditor').value = data.content;
      renderBackups(data.backups);
      markDirty();
    } catch (err) {
      setAlert('Errore di rete: ' + err.message, 'danger');
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
      setAlert('Errore di rete: ' + err.message, 'danger');
    }
  }

  async function save() {
    clearAlert();
    try {
      const res = await fetch(SN_API + '/rules/save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: $('rulesEditor').value }),
      });
      const data = await res.json();

      if (!data.saved) {
        renderValidation(data);
        setAlert('Salvataggio rifiutato: il file su disco non è stato toccato.', 'danger');
        return;
      }

      savedContent = $('rulesEditor').value;
      markDirty();
      // reloadRules() è già stato chiamato dal server: le regole sono in vigore
      // adesso, senza riavvio.
      setAlert('Salvato e ricaricato: ' + data.ruleCount + ' regole attive'
        + (data.backup ? ' (backup: ' + data.backup + ')' : ''), 'success');
      load();
    } catch (err) {
      setAlert('Errore di rete: ' + err.message, 'danger');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('rulesEditor').addEventListener('input', markDirty);
    $('btnReload').addEventListener('click', load);
    $('btnValidate').addEventListener('click', validate);
    $('btnSave').addEventListener('click', save);

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
