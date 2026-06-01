/* globals apiPrefix, autoRefreshSeconds, auditLimit, escapeHtml */

/**
 * rateLimiter-admin.js — logica client della dashboard adminRateLimiter (Vista Dati).
 *
 * Recupera stato/blocchi (/api/adminRateLimiter/status) e audit log
 * (/api/adminRateLimiter/attempts), popola KPI/tabelle e gestisce l'auto-refresh.
 * Variabili iniettate da index.ejs: apiPrefix, autoRefreshSeconds, auditLimit.
 * escapeHtml() è fornito globalmente dal tema admin.
 */
(function () {
  'use strict';

  // Fallback difensivo se escapeHtml globale non fosse disponibile
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

  /** Formatta una durata in secondi → "Xh Ym" / "Xm Ys" / "Xs". */
  function formatDuration(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  /** ISO/epoch → orario locale leggibile. */
  function formatTime(ts) {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
  }

  function tierBadge(tier) {
    const cls = tier === 'long' ? 'bg-danger' : (tier === 'short' ? 'bg-warning text-dark' : 'bg-secondary');
    return `<span class="badge ${cls}">${esc(tier || '—')}</span>`;
  }

  function eventBadge(ev) {
    const map = {
      failure: 'bg-secondary',
      shortBlock: 'bg-warning text-dark',
      longBlock: 'bg-danger',
      manualBlock: 'bg-danger',
      success: 'bg-success',
      release: 'bg-info text-dark',
      releaseAll: 'bg-info text-dark',
    };
    return `<span class="badge ${map[ev] || 'bg-light text-dark'}">${esc(ev || '—')}</span>`;
  }

  // ── Fetch + render ──────────────────────────────────────────────────────────

  async function fetchStatus() {
    const res = await fetch(`/${apiPrefix}/adminRateLimiter/status`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();

    const disabledBanner = el('disabledBanner');
    if (!data.enabled) {
      disabledBanner.classList.remove('d-none');
      el('statusBadge').className = 'badge bg-secondary align-middle ms-2';
      el('statusBadge').textContent = '—';
      ['kpiEnforcement', 'kpiActive', 'kpiShort', 'kpiLong', 'kpiRules'].forEach((id) => { el(id).textContent = '—'; });
      el('activeBlocksBody').innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">—</td></tr>';
      return;
    }
    disabledBanner.classList.add('d-none');

    const s = data.stats || {};
    const badge = el('statusBadge');
    if (s.enforcementEnabled) {
      badge.className = 'badge bg-success align-middle ms-2';
      badge.textContent = 'attivo';
    } else {
      badge.className = 'badge bg-warning text-dark align-middle ms-2';
      badge.textContent = 'enforcement off';
    }

    el('kpiEnforcement').textContent = s.enforcementEnabled ? 'ON' : 'OFF';
    el('kpiActive').textContent = s.activeBlocks != null ? s.activeBlocks : '—';
    el('kpiShort').textContent = s.shortBlocks != null ? s.shortBlocks : '—';
    el('kpiLong').textContent = s.longBlocks != null ? s.longBlocks : '—';
    el('kpiRules').textContent = s.ruleCount != null ? s.ruleCount : '—';

    renderActiveBlocks(data.activeBlocks || []);
  }

  function renderActiveBlocks(blocks) {
    const body = el('activeBlocksBody');
    if (!blocks.length) {
      body.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">nessun blocco attivo</td></tr>';
      return;
    }
    body.innerHTML = blocks.map((b) => `
      <tr>
        <td><code>${esc(b.clientId)}</code></td>
        <td>${esc(b.ruleName)}</td>
        <td>${tierBadge(b.tier)}</td>
        <td>${esc(formatDuration(b.retryAfterSeconds))}</td>
        <td class="text-end">${Number(b.shortBlockCount) || 0}</td>
      </tr>`).join('');
  }

  async function fetchAttempts() {
    const res = await fetch(`/${apiPrefix}/adminRateLimiter/attempts?limit=${encodeURIComponent(auditLimit)}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`attempts ${res.status}`);
    const data = await res.json();
    const attempts = data.attempts || [];
    el('auditCount').textContent = attempts.length ? `${attempts.length}` : '';

    const body = el('auditBody');
    if (!attempts.length) {
      body.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">nessun evento</td></tr>';
      return;
    }
    body.innerHTML = attempts.map((a) => `
      <tr>
        <td class="text-nowrap small">${esc(formatTime(a.ts))}</td>
        <td>${eventBadge(a.event)}</td>
        <td><code>${esc(a.clientId)}</code></td>
        <td>${esc(a.ruleName || '—')}</td>
      </tr>`).join('');
  }

  async function refreshAll() {
    const spinner = el('loadingSpinner');
    spinner.classList.remove('d-none');
    try {
      await Promise.all([fetchStatus(), fetchAttempts()]);
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

  document.addEventListener('DOMContentLoaded', function () {
    el('btnRefresh').addEventListener('click', refreshAll);
    const toggle = el('autoRefreshToggle');
    toggle.addEventListener('change', () => { if (toggle.checked) startAuto(); else stopAuto(); });

    refreshAll();
    if (toggle.checked) startAuto();
  });
})();
