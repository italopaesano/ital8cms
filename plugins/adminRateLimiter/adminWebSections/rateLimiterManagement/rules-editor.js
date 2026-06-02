/* globals apiPrefix, escapeHtml, i18n */

/**
 * rules-editor.js — editor delle Regole (protectedRoutes.json5).
 *
 * Vista C (form: una card per regola) coordinata con la Vista B (editor JSON5 grezzo).
 * La textarea è la fonte inviata al server; il form la rigenera. Il form si popola
 * dalle `rules` GIÀ PARSE-ATE lato server (il file è JSON5 con commenti, quindi il
 * browser non deve fare JSON5.parse). Il toggle JSON→Form usa JSON.parse: se la
 * textarea contiene commenti/JSON5 non importabile, avvisa e resta in vista JSON5.
 *
 * Endpoint invariati: GET /rules (ora con `rules`), POST /validate-rules, POST /rules.
 */
(function () {
  'use strict';

  const OVERRIDE_FIELDS = ['findWindowSeconds', 'maxFailures', 'shortBlockSeconds', 'maxShortBlocks', 'longBlockSeconds', 'escalationResetSeconds'];

  const esc = (typeof escapeHtml === 'function')
    ? escapeHtml
    : (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

  function el(id) { return document.getElementById(id); }

  let dirty = false;
  function markDirty() { dirty = true; }

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

  // ── card regola ──
  function buildRuleCard(rule) {
    rule = rule || {};
    const card = document.createElement('div');
    card.className = 'card mb-2 rl-rule-card';
    card.innerHTML = `
      <div class="card-body">
        <div class="row g-2 align-items-end mb-1">
          <div class="col-md-4">
            <label class="form-label small mb-0">name</label>
            <input type="text" class="form-control form-control-sm rl-r-name" placeholder="${esc(i18n.namePlaceholder || 'name')}">
          </div>
          <div class="col-md-6">
            <label class="form-label small mb-0">pathPattern</label>
            <input type="text" class="form-control form-control-sm rl-r-pathPattern" placeholder="(opzionale)">
          </div>
          <div class="col-md-2 text-end">
            <button type="button" class="btn btn-outline-danger btn-sm rl-r-remove" title="${esc(i18n.remove || 'remove')}">✕</button>
          </div>
        </div>
        <div class="row g-2">
          ${OVERRIDE_FIELDS.map((f) => `
            <div class="col-6 col-md-2">
              <label class="form-label small mb-0">${f}</label>
              <input type="number" class="form-control form-control-sm rl-r-ov" data-field="${f}" placeholder="default">
            </div>`).join('')}
        </div>
      </div>`;

    card.querySelector('.rl-r-name').value = rule.name || '';
    card.querySelector('.rl-r-pathPattern').value = rule.pathPattern || '';
    OVERRIDE_FIELDS.forEach((f) => {
      card.querySelector(`.rl-r-ov[data-field="${f}"]`).value = (rule[f] == null ? '' : rule[f]);
    });
    card.querySelector('.rl-r-remove').addEventListener('click', () => { card.remove(); markDirty(); });
    card.querySelectorAll('input').forEach((i) => i.addEventListener('input', markDirty));
    return card;
  }

  function gatherRuleCard(card) {
    const rule = { name: card.querySelector('.rl-r-name').value.trim() };
    const pp = card.querySelector('.rl-r-pathPattern').value.trim();
    if (pp) rule.pathPattern = pp;
    card.querySelectorAll('.rl-r-ov').forEach((inp) => {
      const v = inp.value.trim();
      if (v !== '') {
        const n = parseInt(v, 10);
        if (Number.isFinite(n)) rule[inp.getAttribute('data-field')] = n;
      }
    });
    return rule;
  }

  function gatherRulesForm() {
    const cards = Array.from(document.querySelectorAll('#rulesContainer .rl-rule-card'));
    return { rules: cards.map(gatherRuleCard) };
  }

  function renderRulesForm(rules) {
    const c = el('rulesContainer');
    c.innerHTML = '';
    (Array.isArray(rules) ? rules : []).forEach((r) => c.appendChild(buildRuleCard(r)));
  }

  // ── viste ──
  function showFormView() { el('rulesFormView').classList.remove('d-none'); el('rulesJsonView').classList.add('d-none'); }
  function showJsonView() { el('rulesJsonView').classList.remove('d-none'); el('rulesFormView').classList.add('d-none'); }
  function isFormView() { return el('viewForm').checked; }

  /** Se la vista attiva è il Form, rigenera la textarea; ritorna il contenuto da inviare. */
  function ensureContent() {
    if (isFormView()) el('rulesEditor').value = JSON.stringify(gatherRulesForm(), null, 2);
    return el('rulesEditor').value;
  }

  // ── load / validate / save ──
  async function loadRules() {
    try {
      const res = await fetch(`/${apiPrefix}/adminRateLimiter/rules`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      el('rulesEditor').value = data.content || '';
      renderRulesForm(data.rules || []);
      if (!data.enabled) {
        el('disabledBanner').classList.remove('d-none');
        el('btnValidate').disabled = true;
        el('btnSave').disabled = true;
      }
      dirty = false;
    } catch (err) {
      showAlert('Errore caricamento: ' + err.message, 'danger');
    }
  }

  async function validateRules() {
    const content = ensureContent();
    try {
      const res = await fetch(`/${apiPrefix}/adminRateLimiter/validate-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ content }),
      });
      renderMessages(await res.json());
    } catch (err) {
      showAlert(err.message, 'danger');
    }
  }

  async function saveRules() {
    el('messages').innerHTML = '';
    const content = ensureContent();
    try {
      const res = await fetch(`/${apiPrefix}/adminRateLimiter/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        renderMessages({ errors: data.errors || [data.error || `HTTP ${res.status}`], warnings: data.warnings });
        return;
      }
      showAlert(i18n.saved, 'success');
      renderMessages({ warnings: data.warnings });
      dirty = false;
    } catch (err) {
      showAlert(err.message, 'danger');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    el('btnValidate').addEventListener('click', validateRules);
    el('btnSave').addEventListener('click', saveRules);
    el('btnAddRule').addEventListener('click', () => { el('rulesContainer').appendChild(buildRuleCard({})); markDirty(); });
    el('rulesEditor').addEventListener('input', markDirty);

    el('viewForm').addEventListener('change', () => {
      if (!el('viewForm').checked) return;
      let parsed;
      try { parsed = JSON.parse(el('rulesEditor').value); } catch (e) {
        showAlert(i18n.parseError, 'warning');
        el('viewJson').checked = true;
        showJsonView();
        return;
      }
      renderRulesForm(parsed && Array.isArray(parsed.rules) ? parsed.rules : []);
      showFormView();
    });
    el('viewJson').addEventListener('change', () => {
      if (!el('viewJson').checked) return;
      el('rulesEditor').value = JSON.stringify(gatherRulesForm(), null, 2);
      showJsonView();
    });

    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

    loadRules();
  });
})();
