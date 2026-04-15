/* globals Chart, apiPrefix, adminPrefix, maxRawLogRows, exportWarningThreshold, escapeHtml */

/**
 * analytics.js — Client-side logic for the adminAnalytics dashboard.
 *
 * Responsibilities:
 *   - Fetch aggregated stats from /api/adminAnalytics/stats
 *   - Render KPI cards, Chart.js charts, and data tables
 *   - Manage the paginated raw log (/api/adminAnalytics/events)
 *   - Handle period selector, filters, refresh, and export
 *
 * Depends on:
 *   - Chart.js (loaded before this script via chart.umd.min.js)
 *   - escapeHtml()  (provided globally by the admin theme's escapeHtml.js)
 *   - Bootstrap 5 tab component (via the admin theme)
 *   - Variables injected by index.ejs:
 *       apiPrefix, adminPrefix, maxRawLogRows, exportWarningThreshold
 */

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  /** @type {object|null} Last successful stats API response */
  let currentStats = null;

  /** @type {object} Chart instances keyed by canvas id */
  const charts = {};

  /** Pagination state for the raw log tab */
  const rawState = { page: 1, pages: 1, total: 0, limit: 50 };

  // ── DOM helpers ───────────────────────────────────────────────────────────

  function el(id) { return document.getElementById(id); }

  function showAlert(msg, type) {
    const div = el('globalAlert');
    div.className = `alert alert-${type || 'danger'} mb-3`;
    div.textContent = msg;
    div.classList.remove('d-none');
    setTimeout(() => div.classList.add('d-none'), 6000);
  }

  function setLoading(on) {
    el('btnRefresh').disabled = on;
    el('loadingSpinner').classList.toggle('d-none', !on);
  }

  // ── Date helpers ──────────────────────────────────────────────────────────

  /** Returns today's date as "YYYY-MM-DD" (local time) */
  function todayStr() {
    const d = new Date();
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('-');
  }

  /** Returns the date n days ago as "YYYY-MM-DD" (local time, inclusive) */
  function daysAgoStr(n) {
    const d = new Date();
    d.setDate(d.getDate() - n + 1);
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('-');
  }

  function setDateRange(from, to) {
    el('inputFrom').value = from;
    el('inputTo').value   = to;
  }

  // ── Query string builder ──────────────────────────────────────────────────

  /**
   * Builds the query string from the current filter form state.
   * Extra key/value pairs can be merged in via extraParams.
   *
   * @param {object} [extraParams]
   * @returns {string}
   */
  function buildQs(extraParams) {
    const params = new URLSearchParams();
    params.set('from',        el('inputFrom').value       || '');
    params.set('to',          el('inputTo').value         || '');
    params.set('trafficType', el('selTrafficType').value  || 'all');
    params.set('authType',    el('selAuthType').value     || 'all');
    params.set('context',     el('selContext').value      || 'all');
    params.set('statusGroup', el('selStatusGroup').value  || 'all');
    params.set('pathSearch',  el('inputPathSearch').value || '');
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) params.set(k, v);
    }
    return params.toString();
  }

  // ── API fetch helper ──────────────────────────────────────────────────────

  async function apiGet(endpoint, extraParams) {
    const url = `/${apiPrefix}/adminAnalytics/${endpoint}?${buildQs(extraParams)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} — ${text.substring(0, 120)}`);
    }
    return res.json();
  }

  // ── Chart management ──────────────────────────────────────────────────────

  /**
   * Creates a Chart.js instance on the canvas with the given id, or updates
   * an existing one if already created (avoids re-creating on tab switches).
   */
  function syncChart(id, type, data, options) {
    const canvas = el(id);
    if (!canvas) return;
    if (charts[id]) {
      charts[id].data = data;
      charts[id].update('none'); // skip animation on update
    } else {
      charts[id] = new Chart(canvas, { type, data, options: options || {} });
    }
  }

  // ── KPI cards ─────────────────────────────────────────────────────────────

  function renderKpiCards(totals) {
    el('kpiTotalVisits').textContent    = totals.totalVisits.toLocaleString();
    el('kpiUniqueSessions').textContent = totals.uniqueSessions.toLocaleString();
    el('kpiBotPct').textContent         = totals.botPercentage + '%';
    el('kpiAvgResponse').textContent    = totals.avgResponseMs + ' ms';
    el('kpiErrors').textContent         = totals.errorCount.toLocaleString();

    const topPage = el('kpiTopPage');
    topPage.textContent = totals.topPage || '—';
    topPage.title       = totals.topPage || '';
  }

  // ── Charts ────────────────────────────────────────────────────────────────

  function renderVisitsTrend(cd) {
    syncChart('chartVisitsTrend', 'line', cd.visitsTrend, {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        x: { ticks: { maxTicksLimit: 18, maxRotation: 45 } },
      },
    });
  }

  function renderTopPagesChart(cd) {
    syncChart('chartTopPages', 'bar', cd.topPages, {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    });
  }

  function renderTopBotsChart(cd, topBots) {
    const noBots = el('noBotsMessage');
    const canvas = el('chartTopBots');
    if (!topBots || topBots.length === 0) {
      noBots.classList.remove('d-none');
      if (canvas) canvas.style.display = 'none';
      return;
    }
    noBots.classList.add('d-none');
    if (canvas) canvas.style.display = '';
    syncChart('chartTopBots', 'doughnut', cd.topBots, {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'right' } },
    });
  }

  function renderStatusCodesChart(cd) {
    syncChart('chartStatusCodes', 'bar', cd.statusCodes, {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    });
  }

  // ── Tables ────────────────────────────────────────────────────────────────

  function renderTopPagesTable(topPages) {
    const tbody = el('tbodyTopPages');
    if (!topPages.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">—</td></tr>';
      return;
    }
    tbody.innerHTML = topPages.map(p =>
      `<tr>
        <td class="text-truncate" style="max-width:280px" title="${escapeHtml(p.path)}">${escapeHtml(p.path)}</td>
        <td class="text-end">${p.count.toLocaleString()}</td>
        <td class="text-end">${p.uniqueSessions.toLocaleString()}</td>
      </tr>`
    ).join('');
  }

  function renderTopBotsTable(topBots) {
    const tbody = el('tbodyTopBots');
    if (!topBots.length) {
      tbody.innerHTML = '<tr><td colspan="2" class="text-center text-muted py-3">—</td></tr>';
      return;
    }
    tbody.innerHTML = topBots.map(b =>
      `<tr>
        <td>${escapeHtml(b.botName)}</td>
        <td class="text-end">${b.count.toLocaleString()}</td>
      </tr>`
    ).join('');
  }

  function renderReferrersTable(referrers) {
    const tbody = el('tbodyReferrers');
    if (!referrers.length) {
      tbody.innerHTML = '<tr><td colspan="2" class="text-center text-muted py-3">—</td></tr>';
      return;
    }
    tbody.innerHTML = referrers.map(r =>
      `<tr>
        <td class="text-truncate" style="max-width:360px" title="${escapeHtml(r.referrer)}">${escapeHtml(r.referrer)}</td>
        <td class="text-end">${r.count.toLocaleString()}</td>
      </tr>`
    ).join('');
  }

  // ── Raw log ───────────────────────────────────────────────────────────────

  async function loadRawLog(page) {
    try {
      const data = await apiGet('events', { page, limit: rawState.limit });
      rawState.page  = data.page;
      rawState.pages = data.pages;
      rawState.total = data.total;
      renderRawLogTable(data.events, data.capped, data.total);
      renderPagination();
      el('rawLogCount').textContent =
        `${data.total.toLocaleString()} event${data.total !== 1 ? 's' : ''}`;
    } catch (err) {
      showAlert('Error loading raw log: ' + err.message);
    }
  }

  function statusClass(code) {
    if (!code) return '';
    if (code < 300) return 'text-success';
    if (code < 400) return 'text-primary';
    if (code < 500) return 'text-warning';
    return 'text-danger fw-semibold';
  }

  function renderRawLogTable(events, capped, total) {
    const capBanner = el('capBanner');
    if (capped) {
      capBanner.classList.remove('d-none');
      el('capMaxRows').textContent = maxRawLogRows.toLocaleString();
    } else {
      capBanner.classList.add('d-none');
    }

    const tbody = el('tbodyRawLog');
    if (!events.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No events found</td></tr>';
      return;
    }

    tbody.innerHTML = events.map(ev => {
      const ts       = ev.timestamp ? ev.timestamp.replace('T', ' ').substring(0, 19) : '';
      const botBadge = ev.isBot
        ? '<span class="badge bg-warning text-dark">Bot</span>'
        : '<span class="badge bg-success">Human</span>';
      const authIcon = ev.isAuthenticated
        ? '<i class="bi bi-lock-fill text-primary" title="Authenticated"></i>'
        : '';

      return `<tr>
        <td class="text-nowrap small font-monospace">${escapeHtml(ts)}</td>
        <td class="text-truncate" style="max-width:200px" title="${escapeHtml(ev.path || '')}">${escapeHtml(ev.path || '')}</td>
        <td class="text-nowrap small">${escapeHtml(ev.method || '')}</td>
        <td class="${statusClass(ev.statusCode)} fw-semibold">${ev.statusCode || ''}</td>
        <td class="text-end small">${typeof ev.durationMs === 'number' ? ev.durationMs : ''}</td>
        <td>${botBadge}</td>
        <td class="text-center">${authIcon}</td>
        <td class="text-truncate" style="max-width:160px" title="${escapeHtml(ev.referrer || '')}">${escapeHtml(ev.referrer || '—')}</td>
      </tr>`;
    }).join('');
  }

  function renderPagination() {
    const container = el('rawLogPagination');
    const { page, pages } = rawState;
    if (pages <= 1) { container.innerHTML = ''; return; }

    let html = '<ul class="pagination pagination-sm mb-0">';

    // Previous
    html += `<li class="page-item${page <= 1 ? ' disabled' : ''}">
      <a class="page-link" href="#" data-page="${page - 1}">‹</a></li>`;

    // Page window
    const first = Math.max(1, page - 2);
    const last  = Math.min(pages, page + 2);

    if (first > 1) {
      html += `<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>`;
      if (first > 2) html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
    }
    for (let i = first; i <= last; i++) {
      html += `<li class="page-item${i === page ? ' active' : ''}">
        <a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
    }
    if (last < pages) {
      if (last < pages - 1) html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
      html += `<li class="page-item"><a class="page-link" href="#" data-page="${pages}">${pages}</a></li>`;
    }

    // Next
    html += `<li class="page-item${page >= pages ? ' disabled' : ''}">
      <a class="page-link" href="#" data-page="${page + 1}">›</a></li>`;
    html += '</ul>';

    container.innerHTML = html;

    // Bind click handlers
    container.querySelectorAll('a[data-page]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        const p = parseInt(a.dataset.page, 10);
        if (p >= 1 && p <= rawState.pages && p !== rawState.page) loadRawLog(p);
      });
    });
  }

  // ── Main load function ────────────────────────────────────────────────────

  async function loadData() {
    setLoading(true);
    try {
      currentStats = await apiGet('stats');

      // Period label
      el('periodLabel').textContent =
        `${currentStats.period.from} → ${currentStats.period.to}  [${currentStats.period.groupBy}]`;

      // Overview tab
      renderKpiCards(currentStats.totals);
      renderVisitsTrend(currentStats.chartData);

      // Pages tab
      renderTopPagesChart(currentStats.chartData);
      renderTopPagesTable(currentStats.topPages);
      renderStatusCodesChart(currentStats.chartData);

      // Bots tab
      renderTopBotsChart(currentStats.chartData, currentStats.topBots);
      renderTopBotsTable(currentStats.topBots);

      // Referrer tab
      renderReferrersTable(currentStats.referrers);

      // Raw tab: reload only if the tab is currently visible
      if (el('tab-raw').classList.contains('show')) {
        loadRawLog(1);
      }

    } catch (err) {
      showAlert('Error loading analytics: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  function triggerExport(format) {
    if (
      exportWarningThreshold > 0 &&
      currentStats &&
      currentStats.totals.totalVisits > exportWarningThreshold
    ) {
      const n = currentStats.totals.totalVisits.toLocaleString();
      if (!confirm(`Warning: the current selection contains ${n} events. The exported file may be very large. Continue?`)) {
        return;
      }
    }
    window.location.href = `/${apiPrefix}/adminAnalytics/export?${buildQs({ format })}`;
  }

  // ── Initialisation ────────────────────────────────────────────────────────

  function init() {
    // Set default date range: last 30 days
    setDateRange(daysAgoStr(30), todayStr());

    // Quick period buttons
    el('btn7d').addEventListener('click',  () => { setDateRange(daysAgoStr(7),   todayStr()); loadData(); });
    el('btn30d').addEventListener('click', () => { setDateRange(daysAgoStr(30),  todayStr()); loadData(); });
    el('btn90d').addEventListener('click', () => { setDateRange(daysAgoStr(90),  todayStr()); loadData(); });
    el('btn1y').addEventListener('click',  () => { setDateRange(daysAgoStr(365), todayStr()); loadData(); });

    // Refresh
    el('btnRefresh').addEventListener('click', loadData);

    // Export
    el('btnExportCsv').addEventListener('click',  e => { e.preventDefault(); triggerExport('csv'); });
    el('btnExportJson').addEventListener('click', e => { e.preventDefault(); triggerExport('json'); });

    // Load raw log when raw tab becomes visible
    document.querySelectorAll('#analyticsTabs [data-bs-toggle="tab"]').forEach(tab => {
      tab.addEventListener('shown.bs.tab', e => {
        if (e.target.dataset.bsTarget === '#tab-raw') loadRawLog(1);
      });
    });

    // Initial data load
    loadData();
  }

  document.addEventListener('DOMContentLoaded', init);

})();
