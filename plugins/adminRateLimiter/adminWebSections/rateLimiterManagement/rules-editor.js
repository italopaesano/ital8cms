/* globals apiPrefix, escapeHtml, i18n */

/**
 * rules-editor.js — editor JSON5 grezzo per protectedRoutes.json5 (tab Regole).
 * Carica il contenuto (/rules), valida (/validate-rules) e salva (/rules, che
 * valida server-side, fa backup, scrive in modo atomico e ricarica le regole).
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

  async function loadRules() {
    try {
      const res = await fetch(`/${apiPrefix}/adminRateLimiter/rules`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      el('rulesEditor').value = data.content || '';
      if (!data.enabled) {
        el('disabledBanner').classList.remove('d-none');
        el('btnValidate').disabled = true;
        el('btnSave').disabled = true;
      }
    } catch (err) {
      showAlert('Errore caricamento: ' + err.message, 'danger');
    }
  }

  async function validateRules() {
    try {
      const res = await fetch(`/${apiPrefix}/adminRateLimiter/validate-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ content: el('rulesEditor').value }),
      });
      renderMessages(await res.json());
    } catch (err) {
      showAlert(err.message, 'danger');
    }
  }

  async function saveRules() {
    el('messages').innerHTML = '';
    try {
      const res = await fetch(`/${apiPrefix}/adminRateLimiter/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ content: el('rulesEditor').value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        renderMessages({ errors: data.errors || [data.error || `HTTP ${res.status}`], warnings: data.warnings });
        return;
      }
      showAlert(i18n.saved, 'success');
      renderMessages({ warnings: data.warnings });
    } catch (err) {
      showAlert(err.message, 'danger');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    el('btnValidate').addEventListener('click', validateRules);
    el('btnSave').addEventListener('click', saveRules);
    loadRules();
  });
})();
