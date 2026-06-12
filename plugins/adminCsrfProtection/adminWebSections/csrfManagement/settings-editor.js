/* globals apiPrefix, escapeHtml, i18n */

/**
 * settings-editor.js — editor JSON5 del blocco "custom" di pluginConfig.json5 del
 * servizio csrfProtection. Carica (/config), valida (/validate-config), salva
 * (/config: valida server-side, backup, editJson5 del solo blocco custom,
 * reloadConfig). "Salva e riavvia" salva e poi chiama /restart.
 *
 * NB: le POST ricevono l'header X-CSRF-Token via interceptor (pagina admin).
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
    if (result.valid) {
      parts.push(`<div class="alert alert-success py-2 mb-2">✓ ${esc(i18n.valid)}</div>`);
    }
    if (result.errors && result.errors.length) {
      parts.push(`<div class="alert alert-danger py-2 mb-2"><ul class="mb-0">${result.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`);
    }
    if (result.warnings && result.warnings.length) {
      parts.push(`<div class="alert alert-warning py-2 mb-2"><ul class="mb-0">${result.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`);
    }
    el('messages').innerHTML = parts.join('');
  }

  function setDisabled(on) {
    ['btnValidate', 'btnSave', 'btnSaveRestart'].forEach((id) => { el(id).disabled = on; });
  }

  async function loadConfig() {
    try {
      const res = await fetch(`/${apiPrefix}/adminCsrfProtection/config`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      el('configEditor').value = data.content || '{}';
      if (!data.enabled) {
        el('disabledBanner').classList.remove('d-none');
        setDisabled(true);
      }
    } catch (err) {
      showAlert('Errore caricamento: ' + err.message, 'danger');
    }
  }

  async function validateConfig() {
    try {
      const res = await fetch(`/${apiPrefix}/adminCsrfProtection/validate-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ content: el('configEditor').value }),
      });
      renderMessages(await res.json());
    } catch (err) {
      showAlert(err.message, 'danger');
    }
  }

  /** @returns {Promise<boolean>} true se il salvataggio è andato a buon fine */
  async function saveConfig() {
    el('messages').innerHTML = '';
    const res = await fetch(`/${apiPrefix}/adminCsrfProtection/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ content: el('configEditor').value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      renderMessages({ errors: data.errors || [data.error || `HTTP ${res.status}`], warnings: data.warnings });
      return false;
    }
    renderMessages({ warnings: data.warnings });
    return true;
  }

  async function onSave() {
    try {
      if (await saveConfig()) showAlert(i18n.saved, 'success');
    } catch (err) {
      showAlert(err.message, 'danger');
    }
  }

  async function onSaveRestart() {
    try {
      if (!(await saveConfig())) return;
      const res = await fetch(`/${apiPrefix}/adminCsrfProtection/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showAlert(data.error || `HTTP ${res.status}`, 'danger');
        return;
      }
      showAlert(i18n.restarting, 'warning');
    } catch (err) {
      showAlert(err.message, 'danger');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    el('btnValidate').addEventListener('click', validateConfig);
    el('btnSave').addEventListener('click', onSave);
    el('btnSaveRestart').addEventListener('click', onSaveRestart);
    loadConfig();
  });
})();
