/* globals apiPrefix, autoRefreshSeconds, auditLimit, escapeHtml, i18n */

/**
 * csrf-admin.js — logica client della dashboard adminCsrfProtection (Vista Dati).
 *
 * Recupera stato/statistiche (/api/adminCsrfProtection/status) e blocchi recenti
 * (/api/adminCsrfProtection/recent), popola KPI/tabella, gestisce l'auto-refresh
 * e il "CSRF tester" (/api/adminCsrfProtection/simulate).
 *
 * NB: le POST (simulate) ricevono automaticamente l'header X-CSRF-Token grazie
 * all'interceptor iniettato da csrfProtection (questa è una pagina admin con il
 * <meta csrf-token> nell'head). Nessuna gestione esplicita del token qui.
 */
(function () {
  'use strict';

  const esc = (typeof escapeHtml === 'function')
    ? escapeHtml
    : (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

  let timer = null;
  function el(id) { return document.getElementById(id); }

  function showAlert(msg, type) {
    const div = el('globalAlert');
    div.className = `alert alert-${type || 'danger'}`;
    div.textContent = msg;
    div.classList.remove('d-none');
    setTimeout(() => div.classList.add('d-none'), 6000);
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
  }

  function reasonBadge(reason) {
    const r = String(reason || '');
    if (r.startsWith('origin_mismatch')) return `<span class="badge bg-danger">${esc(r)}</span>`;
    if (r === 'missing_or_invalid_token') return `<span class="badge bg-warning text-dark">${esc(r)}</span>`;
    return `<span class="badge bg-light text-dark">${esc(r || '—')}</span>`;
  }

  // ── Fetch + render ──────────────────────────────────────────────────────────

  async function fetchStatus() {
    const res = await fetch(`/${apiPrefix}/adminCsrfProtection/status`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();

    const disabledBanner = el('disabledBanner');
    const badge = el('statusBadge');
    if (!data.enabled) {
      disabledBanner.classList.remove('d-none');
      badge.className = 'badge bg-danger align-middle ms-2';
      badge.textContent = 'OFF';
      ['kpiOriginCheck', 'kpiTotal', 'kpiToken', 'kpiOrigin', 'kpiExempt'].forEach((id) => { el(id).textContent = '—'; });
      return;
    }
    disabledBanner.classList.add('d-none');

    const s = data.stats || {};
    badge.className = 'badge bg-success align-middle ms-2';
    badge.textContent = 'ON';

    const byReason = s.blocksByReason || {};
    el('kpiOriginCheck').textContent = s.originCheckEnabled ? 'ON' : 'OFF';
    el('kpiTotal').textContent = s.totalBlocks != null ? s.totalBlocks : '—';
    el('kpiToken').textContent = byReason.missing_or_invalid_token != null ? byReason.missing_or_invalid_token : 0;
    el('kpiOrigin').textContent = byReason.origin_mismatch != null ? byReason.origin_mismatch : 0;
    el('kpiExempt').textContent = s.exemptCount != null ? s.exemptCount : '—';
  }

  async function fetchRecent() {
    const res = await fetch(`/${apiPrefix}/adminCsrfProtection/recent?limit=${encodeURIComponent(auditLimit)}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`recent ${res.status}`);
    const data = await res.json();
    const blocks = data.blocks || [];
    el('recentCount').textContent = blocks.length ? `${blocks.length}` : '';

    const body = el('recentBody');
    if (!blocks.length) {
      body.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">${esc(i18n.noBlocks)}</td></tr>`;
      return;
    }
    body.innerHTML = blocks.map((b) => `
      <tr>
        <td class="text-nowrap small">${esc(formatTime(b.ts))}</td>
        <td><code>${esc(b.method || '—')}</code></td>
        <td class="text-break">${esc(b.path || '—')}</td>
        <td>${reasonBadge(b.reason)}</td>
        <td><code>${esc(b.ip || '—')}</code></td>
      </tr>`).join('');
  }

  async function refreshAll() {
    const spinner = el('loadingSpinner');
    spinner.classList.remove('d-none');
    try {
      await Promise.all([fetchStatus(), fetchRecent()]);
    } catch (err) {
      showAlert('Errore nel recupero dei dati: ' + err.message, 'danger');
    } finally {
      spinner.classList.add('d-none');
    }
  }

  function startAuto() {
    stopAuto();
    const sec = Number(autoRefreshSeconds) || 5;
    timer = setInterval(refreshAll, sec * 1000);
  }
  function stopAuto() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  // ── CSRF tester ─────────────────────────────────────────────────────────────

  async function onSimulate(e) {
    e.preventDefault();
    const result = el('simResult');
    result.innerHTML = '';
    try {
      const res = await fetch(`/${apiPrefix}/adminCsrfProtection/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          method: el('simMethod').value,
          path: el('simPath').value.trim(),
          siteOrigin: el('simSiteOrigin').value,
          requestOrigin: el('simReqOrigin').value.trim(),
          tokenProvided: el('simToken').checked,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showAlert(data.error || `HTTP ${res.status}`, 'danger');
        return;
      }
      const v = data.verdict || {};
      if (v.ok) {
        const label = v.skipped ? `${i18n.skipped} (${esc(v.skipped)})` : i18n.pass;
        result.innerHTML = `<div class="alert alert-success py-2 mb-0">✓ ${esc(label)}</div>`;
      } else {
        result.innerHTML = `<div class="alert alert-danger py-2 mb-0">⛔ ${esc(i18n.blocked)} — <code>${esc(v.reason || '')}</code> (HTTP ${Number(v.status) || 403})</div>`;
      }
    } catch (err) {
      showAlert(err.message, 'danger');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Il "site origin" di riferimento per il tester è l'origin corrente.
    el('simSiteOrigin').value = window.location.origin;

    el('btnRefresh').addEventListener('click', refreshAll);
    const toggle = el('autoRefreshToggle');
    toggle.addEventListener('change', () => { if (toggle.checked) startAuto(); else stopAuto(); });
    el('simForm').addEventListener('submit', onSimulate);

    refreshAll();
    if (toggle.checked) startAuto();
  });
})();
