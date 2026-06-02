/* globals apiPrefix, escapeHtml, i18n */

/**
 * settings-editor.js — editor delle Impostazioni (blocco custom di pluginConfig.json5).
 *
 * Vista C (form strutturato) coordinata con la Vista B (editor JSON5 grezzo) sullo
 * stesso contenuto. La textarea è la fonte inviata al server (single source of truth);
 * il form la rigenera. Il toggle sincronizza in modo esplicito le due viste.
 *
 * Endpoint (invariati): GET /config, POST /validate-config, POST /config, POST /restart.
 * La conversione form↔JSON è client-side: il contenuto è JSON (la GET /config
 * restituisce JSON.stringify del custom), quindi JSON.parse basta per il toggle.
 */
(function () {
  'use strict';

  const esc = (typeof escapeHtml === 'function')
    ? escapeHtml
    : (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

  function el(id) { return document.getElementById(id); }

  function showAlert(msg, type) {
    const d = el('globalAlert');
    d.className = `alert alert-${type || 'danger'}`;
    d.textContent = msg;
    d.classList.remove('d-none');
    setTimeout(() => d.classList.add('d-none'), 6000);
  }

  function renderMessages(result) {
    const parts = [];
    if (result.valid) parts.push(`<div class="alert alert-success py-2 mb-2">✓ ${esc(i18n.valid)}</div>`);
    if (result.errors && result.errors.length) parts.push(`<div class="alert alert-danger py-2 mb-2"><ul class="mb-0">${result.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`);
    if (result.warnings && result.warnings.length) parts.push(`<div class="alert alert-warning py-2 mb-2"><ul class="mb-0">${result.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`);
    el('messages').innerHTML = parts.join('');
  }

  // id del campo → { path nel custom, tipo }
  const FIELDS = [
    ['f_enabled', ['enabled'], 'bool'],
    ['f_trustProxy', ['trustProxy'], 'bool'],
    ['f_enableLogging', ['enableLogging'], 'bool'],
    ['f_strictValidation', ['strictValidation'], 'bool'],
    ['f_sweepIntervalSeconds', ['sweepIntervalSeconds'], 'int'],
    ['f_def_findWindowSeconds', ['defaults', 'findWindowSeconds'], 'int'],
    ['f_def_maxFailures', ['defaults', 'maxFailures'], 'int'],
    ['f_def_shortBlockSeconds', ['defaults', 'shortBlockSeconds'], 'int'],
    ['f_def_maxShortBlocks', ['defaults', 'maxShortBlocks'], 'int'],
    ['f_def_longBlockSeconds', ['defaults', 'longBlockSeconds'], 'int'],
    ['f_def_escalationResetSeconds', ['defaults', 'escalationResetSeconds'], 'int'],
    ['f_enf_enabled', ['enforcement', 'enabled'], 'bool'],
    ['f_enf_globalLongBlock', ['enforcement', 'globalLongBlock'], 'bool'],
    ['f_enf_status', ['enforcement', 'status'], 'int'],
    ['f_enf_redirectTo', ['enforcement', 'redirectTo'], 'text'],
    ['f_state_flushIntervalSeconds', ['state', 'flushIntervalSeconds'], 'int'],
    ['f_log_enabled', ['log', 'enabled'], 'bool'],
    ['f_log_rotateWhenBytes', ['log', 'rotateWhenBytes'], 'int'],
    ['f_log_retentionDays', ['log', 'retentionDays'], 'int'],
    ['f_resp_status', ['response', 'status'], 'int'],
    ['f_resp_retryAfterHeader', ['response', 'retryAfterHeader'], 'bool'],
  ];

  let currentCustom = {}; // ultimo oggetto completo noto (base per il merge: preserva chiavi ignote)
  let dirty = false;

  function markDirty() { dirty = true; }

  function getPath(obj, p) { let o = obj; for (const k of p) { if (o == null) return undefined; o = o[k]; } return o; }
  function setPath(obj, p, v) {
    let o = obj;
    for (let i = 0; i < p.length - 1; i++) {
      const k = p[i];
      if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
      o = o[k];
    }
    o[p[p.length - 1]] = v;
  }

  // ── exemptPaths list editor ──
  function addExemptRow(value) {
    const wrap = el('exemptPathsList');
    const row = document.createElement('div');
    row.className = 'input-group input-group-sm mb-1';
    row.innerHTML = '<input type="text" class="form-control rl-exempt-input"><button type="button" class="btn btn-outline-danger rl-exempt-remove">✕</button>';
    row.querySelector('.rl-exempt-input').value = value || '';
    row.querySelector('.rl-exempt-input').addEventListener('input', markDirty);
    row.querySelector('.rl-exempt-remove').addEventListener('click', () => { row.remove(); markDirty(); });
    wrap.appendChild(row);
  }
  function getExemptList() {
    return Array.from(document.querySelectorAll('#exemptPathsList .rl-exempt-input'))
      .map((i) => i.value.trim()).filter(Boolean);
  }
  function setExemptList(arr) {
    el('exemptPathsList').innerHTML = '';
    (Array.isArray(arr) ? arr : []).forEach((v) => addExemptRow(v));
  }

  // ── form ↔ object ──
  function populateForm(custom) {
    FIELDS.forEach(([id, p, type]) => {
      const node = el(id);
      if (!node) return;
      const v = getPath(custom, p);
      if (type === 'bool') node.checked = v === true;
      else node.value = (v == null ? '' : v);
    });
    setExemptList(getPath(custom, ['enforcement', 'exemptPaths']) || []);
  }

  function gatherForm() {
    const out = JSON.parse(JSON.stringify(currentCustom || {})); // preserva chiavi non gestite dal form
    FIELDS.forEach(([id, p, type]) => {
      const node = el(id);
      if (!node) return;
      let v;
      if (type === 'bool') v = node.checked;
      else if (type === 'int') { const n = parseInt(node.value, 10); v = Number.isFinite(n) ? n : 0; }
      else v = node.value;
      setPath(out, p, v);
    });
    setPath(out, ['enforcement', 'exemptPaths'], getExemptList());
    return out;
  }

  // ── sync tra viste ──
  function syncFormToTextarea() {
    currentCustom = gatherForm();
    el('configEditor').value = JSON.stringify(currentCustom, null, 2);
  }
  function syncTextareaToForm() {
    let parsed;
    try {
      parsed = JSON.parse(el('configEditor').value);
    } catch (e) {
      showAlert(i18n.parseError + ': ' + e.message, 'danger');
      return false;
    }
    currentCustom = parsed;
    populateForm(parsed);
    return true;
  }
  function isFormView() { return el('viewForm').checked; }

  /** Garantisce che la textarea rifletta la vista attiva, poi ne ritorna il contenuto. */
  function ensureContent() {
    if (isFormView()) syncFormToTextarea();
    return el('configEditor').value;
  }

  function setDisabled(on) {
    ['btnValidate', 'btnSave', 'btnSaveRestart'].forEach((id) => { el(id).disabled = on; });
  }

  // ── load / validate / save ──
  async function loadConfig() {
    try {
      const res = await fetch(`/${apiPrefix}/adminRateLimiter/config`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      const content = data.content || '{}';
      el('configEditor').value = content;
      try { currentCustom = JSON.parse(content); } catch (e) { currentCustom = {}; }
      populateForm(currentCustom);
      if (!data.enabled) {
        el('disabledBanner').classList.remove('d-none');
        setDisabled(true);
      }
      dirty = false;
    } catch (err) {
      showAlert('Errore caricamento: ' + err.message, 'danger');
    }
  }

  async function validateConfig() {
    const content = ensureContent();
    try {
      const res = await fetch(`/${apiPrefix}/adminRateLimiter/validate-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ content }),
      });
      renderMessages(await res.json());
    } catch (err) {
      showAlert(err.message, 'danger');
    }
  }

  async function saveConfig() {
    el('messages').innerHTML = '';
    const content = ensureContent();
    const res = await fetch(`/${apiPrefix}/adminRateLimiter/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      renderMessages({ errors: data.errors || [data.error || `HTTP ${res.status}`], warnings: data.warnings });
      return false;
    }
    renderMessages({ warnings: data.warnings });
    dirty = false;
    return true;
  }

  async function onSave() {
    try { if (await saveConfig()) showAlert(i18n.saved, 'success'); } catch (err) { showAlert(err.message, 'danger'); }
  }

  async function onSaveRestart() {
    try {
      if (!(await saveConfig())) return;
      const res = await fetch(`/${apiPrefix}/adminRateLimiter/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) { showAlert(data.error || `HTTP ${res.status}`, 'danger'); return; }
      showAlert(i18n.restarting, 'warning');
    } catch (err) {
      showAlert(err.message, 'danger');
    }
  }

  function showFormView() { el('formView').classList.remove('d-none'); el('jsonView').classList.add('d-none'); }
  function showJsonView() { el('jsonView').classList.remove('d-none'); el('formView').classList.add('d-none'); }

  document.addEventListener('DOMContentLoaded', function () {
    el('btnValidate').addEventListener('click', validateConfig);
    el('btnSave').addEventListener('click', onSave);
    el('btnSaveRestart').addEventListener('click', onSaveRestart);
    el('btnAddExempt').addEventListener('click', () => { addExemptRow(''); markDirty(); });

    document.querySelectorAll('.rl-field').forEach((n) => n.addEventListener('input', markDirty));
    el('configEditor').addEventListener('input', markDirty);

    // Toggle viste (sync esplicita dalla vista sorgente verso quella di destinazione)
    el('viewForm').addEventListener('change', () => {
      if (!el('viewForm').checked) return;
      if (syncTextareaToForm()) showFormView();
      else { el('viewJson').checked = true; showJsonView(); }
    });
    el('viewJson').addEventListener('change', () => {
      if (!el('viewJson').checked) return;
      syncFormToTextarea();
      showJsonView();
    });

    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

    loadConfig();
  });
})();
