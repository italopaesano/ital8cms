/**
 * sentinel-admin.js — Vista Dati del filtro delle richieste.
 *
 * Tutto il contenuto dinamico passa da escapeHtml() prima di finire in
 * innerHTML: qui si stampano IP, percorsi e User-Agent, cioè stringhe scelte
 * dall'attaccante. Una dashboard di sicurezza che si fa iniettare HTML dai
 * propri dati è un bersaglio, non uno strumento — vedi la strategia di difesa in
 * profondità in CLAUDE.md.
 */

/* global SN_API, SN_AUTO_REFRESH_SECONDS, SN_EVENT_LIMIT, SN_DEFAULT_DAYS, escapeHtml */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (v) => escapeHtml(v === null || v === undefined ? '' : String(v));

  let autoRefreshTimer = null;
  let currentMode = null;

  // ── Utility di presentazione ──────────────────────────────────────────────

  function num(value) {
    return typeof value === 'number' ? value.toLocaleString() : '—';
  }

  function shortTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }

  function bar(count, max) {
    const pct = max > 0 ? Math.round((count / max) * 100) : 0;
    return '<div class="sn-bar"><div class="sn-bar-fill" style="width:' + pct + '%"></div></div>';
  }

  function showAlert(message, kind) {
    const box = $('globalAlert');
    box.className = 'alert alert-' + (kind || 'danger');
    box.textContent = message;
    box.classList.remove('d-none');
  }

  function clearAlert() {
    $('globalAlert').classList.add('d-none');
  }

  async function fetchJson(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function emptyRow(tbody, colspan, text) {
    tbody.innerHTML = '<tr><td colspan="' + colspan + '" class="text-muted p-3">' + esc(text) + '</td></tr>';
  }

  // ── Stato del filtro ──────────────────────────────────────────────────────

  async function loadStatus() {
    const data = await fetchJson(SN_API + '/status');

    $('disabledBanner').classList.toggle('d-none', data.enabled !== false);
    if (!data.enabled) {
      $('modeBadge').className = 'badge bg-secondary align-middle ms-2';
      $('modeBadge').textContent = 'off';
      return false;
    }

    const stats = data.stats || {};
    currentMode = stats.mode || null;
    $('dataDir').textContent = data.dataDir || '—';

    // L'interruttore propone sempre l'altra modalità, così il pulsante dice cosa
    // farà e non in che stato ti trovi — che è già scritto nel badge.
    const btn = $('btnToggleMode');
    btn.disabled = false;
    if (currentMode === 'enforce') {
      btn.className = 'btn btn-outline-secondary btn-sm';
      btn.textContent = '↩ Torna in osservazione';
    } else {
      btn.className = 'btn btn-outline-danger btn-sm';
      btn.textContent = '⏻ Attiva enforcement';
    }

    // Le due condizioni vanno mostrate insieme: `mode: enforce` con il gate su
    // `monitor` non sta bloccando, e dirlo a metà sarebbe peggio che tacere.
    const observing = !data.effectivelyEnforcing;
    $('observingBanner').classList.toggle('d-none', !observing);

    const badge = $('modeBadge');
    if (data.effectivelyEnforcing) {
      badge.className = 'badge bg-danger align-middle ms-2';
      badge.textContent = 'enforce';
    } else {
      badge.className = 'badge bg-info text-dark align-middle ms-2';
      badge.textContent = stats.gateState && stats.gateState !== 'running'
        ? 'gate: ' + stats.gateState
        : 'monitor';
    }

    renderCanary(stats.canary);
    return true;
  }

  // ── Token esca ────────────────────────────────────────────────────────────
  //
  // La card resta nascosta finché nessun token è stato consegnato: una card
  // sempre vuota su una dashboard di sicurezza insegna a smettere di guardarla,
  // e questa è quella che non si deve smettere di guardare.

  function renderCanary(canary) {
    const card = $('canaryCard');
    if (!card) return;

    if (!canary || (!canary.minted && !canary.triggered)) {
      card.classList.add('d-none');
      return;
    }
    card.classList.remove('d-none');

    $('canaryMinted').textContent = num(canary.minted);
    $('canaryTriggered').textContent = num(canary.triggered);
    $('canaryLive').textContent = num(canary.liveTokens);

    const rows = canary.recentTriggers || [];
    const body = $('canaryTable');
    if (rows.length === 0) {
      body.innerHTML = '<tr><td colspan="4" class="text-muted p-3">Nessun token ancora usato.</td></tr>';
      return;
    }

    // esc() su ogni campo: qui si stampano indirizzi e percorsi, cioè
    // stringhe scelte da chi ha fatto la richiesta.
    body.innerHTML = rows.map(function (t) {
      var same = t.sameClient === null || t.sameClient === undefined
        ? '<span class="text-muted">?</span>'
        : (t.sameClient
          ? '<span class="badge bg-secondary">sì</span>'
          : '<span class="badge bg-danger">no</span>');
      return '<tr>'
        + '<td>' + esc(shortTime(t.at)) + '</td>'
        + '<td><code>' + esc(t.usedByIp || '—') + '</code></td>'
        + '<td><code>' + esc(t.deliveredToIp || '—') + '</code></td>'
        + '<td>' + same + '</td>'
        + '</tr>';
    }).join('');
  }

  // ── Panoramica ────────────────────────────────────────────────────────────

  async function loadSummary(days) {
    const data = await fetchJson(SN_API + '/summary?days=' + encodeURIComponent(days));
    if (!data.enabled) return;

    const s = data.summary || {};
    $('kpiTotal').textContent = num(s.total);
    $('kpiEnforced').textContent = num(s.enforced);
    $('kpiIps').textContent = num(s.distinctIps);
    $('kpiFingerprints').textContent = num(s.distinctFingerprints);
    $('kpiIncoherent').textContent = num(s.incoherent);
    $('kpiUnclassified').textContent = (data.unclassified ? data.unclassified.unclassifiedPercent : 0) + '%';

    const tbody = $('categoryTable');
    const rows = s.byCategory || [];
    if (rows.length === 0) {
      emptyRow(tbody, 2, 'Nessun evento nella finestra selezionata.');
      return;
    }
    const max = rows[0].count;
    tbody.innerHTML = rows.map((r) =>
      '<tr><td>' + esc(r.category) + bar(r.count, max) + '</td>'
      + '<td class="text-end align-middle">' + num(r.count) + '</td></tr>').join('');
  }

  // ── Regole ────────────────────────────────────────────────────────────────

  async function loadRules() {
    const data = await fetchJson(SN_API + '/rules');
    const tbody = $('ruleTable');
    const rules = data.rules || [];
    window.__snRules = rules;

    if (rules.length === 0) {
      emptyRow(tbody, 8, 'Nessuna regola definita.');
      return;
    }

    tbody.innerHTML = rules.map((r) => {
      let flag;
      if (r.neverFired) {
        // Zero scatti non vuol dire «sicura»: vuol dire che non si sa niente.
        // Promuoverla sarebbe un atto di fede, non una decisione informata.
        flag = '<span class="badge bg-secondary">mai scattata</span>';
      } else if (!r.defined) {
        flag = '<span class="badge bg-dark">rimossa</span>';
      } else if (r.safeToPromote) {
        flag = '<span class="badge bg-success">sì</span>';
      } else {
        flag = '<span class="badge bg-warning text-dark">no</span>';
      }

      const authClass = r.authenticatedHits > 0 ? 'text-danger fw-bold' : '';
      return '<tr>'
        + '<td><code>' + esc(r.ruleName) + '</code></td>'
        + '<td class="text-end">' + num(r.hits) + '</td>'
        + '<td class="text-end">' + num(r.enforcedHits) + '</td>'
        + '<td class="text-end">' + num(r.distinctIps) + '</td>'
        + '<td class="text-end">' + num(r.botHits) + '</td>'
        + '<td class="text-end ' + authClass + '">' + num(r.authenticatedHits) + '</td>'
        + '<td>' + flag + '</td>'
        + '<td>' + actionButton(r) + '</td>'
        + '</tr>';
    }).join('');

    tbody.querySelectorAll('button[data-rule]').forEach((btn) => {
      btn.addEventListener('click', () => changeRuleAction(btn.dataset.rule, btn.dataset.action));
    });
  }

  /**
   * Il pulsante propone SEMPRE il passo opposto a quello attuale.
   *
   * La retrocessione conta più della promozione: se disfare richiedesse di
   * aprire un editor JSON5 alle tre di notte, nessuno promuoverebbe niente. Per
   * questo su una regola in `block` il pulsante è vistoso quanto quello che l'ha
   * promossa, non nascosto in un menu.
   */
  function actionButton(rule) {
    if (!rule.defined) return '';
    if (rule.action === 'allow') return '';

    if (rule.action === 'block') {
      return '<button class="btn btn-outline-secondary btn-sm py-0" '
        + 'data-rule="' + esc(rule.ruleName) + '" data-action="monitor">↩ retrocedi</button>';
    }
    const warn = rule.authenticatedHits > 0 ? ' sn-risky' : '';
    return '<button class="btn btn-outline-danger btn-sm py-0' + warn + '" '
      + 'data-rule="' + esc(rule.ruleName) + '" data-action="block">⏻ promuovi</button>';
  }

  async function changeRuleAction(ruleName, action) {
    // Promuovere una regola che ha colpito utenti autenticati è la mossa che
    // chiude fuori qualcuno: si chiede conferma nominando il numero.
    const row = (window.__snRules || []).find((r) => r.ruleName === ruleName);
    if (action === 'block' && row && row.authenticatedHits > 0) {
      const ok = window.confirm(
        'Questa regola ha colpito ' + row.authenticatedHits + ' richieste di utenti '
        + 'autenticati. Promuoverla a blocco potrebbe chiudere fuori qualcuno.\n\nProcedere comunque?');
      if (!ok) return;
    }

    try {
      const res = await fetch(SN_API + '/rules/action', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleName: ruleName, action: action }),
      });
      const data = await res.json();
      if (!data.ok) { showAlert('Modifica rifiutata: ' + data.error, 'danger'); return; }

      showAlert('Regola "' + ruleName + '": ' + (data.previous || '?') + ' → ' + action
        + '. In vigore adesso, senza riavvio.', 'success');
      refreshAll();
    } catch (err) {
      showAlert('Errore di rete: ' + err.message, 'danger');
    }
  }

  async function toggleMode() {
    const target = currentMode === 'enforce' ? 'monitor' : 'enforce';
    if (target === 'enforce') {
      const ok = window.confirm(
        'Attivando l\'enforcement le regole in "block" cominceranno a bloccare davvero.\n\n'
        + 'Se qualcosa va storto: npm run cli -- sentinel monitor\n'
        + '(ferma l\'enforcement a caldo SENZA perdere i dati).\n\nProcedere?');
      if (!ok) return;
    }
    try {
      const res = await fetch(SN_API + '/mode', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: target }),
      });
      const data = await res.json();
      if (!data.ok) { showAlert('Cambio modalità rifiutato: ' + data.error, 'danger'); return; }
      showAlert('Modalità globale: ' + target, 'success');
      refreshAll();
    } catch (err) {
      showAlert('Errore di rete: ' + err.message, 'danger');
    }
  }

  // ── Sospetti scanner ──────────────────────────────────────────────────────

  async function loadScanners() {
    const data = await fetchJson(SN_API + '/scanners');
    const tbody = $('scannerTable');
    const rows = data.scanners || [];

    if (rows.length === 0) {
      emptyRow(tbody, 5, 'Nessun client sopra la soglia. È una buona notizia.');
      return;
    }

    tbody.innerHTML = rows.map((c) =>
      '<tr>'
      + '<td><code>' + esc(c.clientId) + '</code></td>'
      + '<td class="text-end fw-bold">' + num(c.distinctPaths) + '</td>'
      + '<td class="text-end">' + num(c.notFound) + '</td>'
      + '<td class="text-end">' + num(c.total) + '</td>'
      + '<td class="small text-muted">' + esc(shortTime(c.lastSeen)) + '</td>'
      + '</tr>').join('');
  }

  // ── Impronte ──────────────────────────────────────────────────────────────

  async function loadFingerprints() {
    const data = await fetchJson(SN_API + '/fingerprints?limit=25');
    const tbody = $('fingerprintTable');
    const rows = data.fingerprints || [];

    $('ipModeBadge').textContent = 'IP: ' + (data.ipMode || '—');

    if (rows.length === 0) {
      emptyRow(tbody, 5, 'Censimento vuoto.');
      return;
    }

    tbody.innerHTML = rows.map((f) => {
      const cls = f.class || {};
      const coherent = cls.coherent === false
        ? '<span class="badge bg-warning text-dark">no</span>'
        : '<span class="badge bg-light text-dark">sì</span>';
      return '<tr>'
        + '<td><code class="sn-fp">' + esc(f.fp) + '</code></td>'
        + '<td>' + esc(cls.family || '—') + '</td>'
        + '<td class="text-end">' + num(f.count) + '</td>'
        + '<td class="text-end">' + (data.ipMode === 'none' ? '—' : num(f.ipCount)) + '</td>'
        + '<td>' + coherent + '</td>'
        + '</tr>';
    }).join('');

    updateEvictionWarning(data.evictions);
  }

  let lastEvictions = 0;
  function updateEvictionWarning(value) {
    lastEvictions = value || 0;
    const box = $('evictionWarning');
    box.classList.toggle('d-none', lastEvictions === 0);
    $('evictionDetail').textContent = ' (' + lastEvictions + ') ';
  }

  // ── Eventi ────────────────────────────────────────────────────────────────

  async function loadEvents() {
    const enforcedOnly = $('enforcedOnlyToggle').checked ? '&enforcedOnly=1' : '';
    const data = await fetchJson(SN_API + '/events?limit=' + SN_EVENT_LIMIT + enforcedOnly);
    const tbody = $('eventTable');
    const rows = data.events || [];

    if (rows.length === 0) {
      emptyRow(tbody, 5, 'Nessun evento registrato.');
      return;
    }

    tbody.innerHTML = rows.map((e) => {
      const outcome = e.enforced
        ? '<span class="badge bg-danger">' + esc(e.action) + '</span>'
        : '<span class="badge bg-secondary">' + esc(e.action) + '</span>';
      return '<tr>'
        + '<td class="small text-muted">' + esc(shortTime(e.timestamp)) + '</td>'
        + '<td class="sn-path"><code>' + esc(e.path) + '</code></td>'
        + '<td class="small">' + esc(e.ruleName || '—') + '</td>'
        + '<td class="small"><code>' + esc(e.ip) + '</code></td>'
        + '<td>' + outcome + '</td>'
        + '</tr>';
    }).join('');
  }

  // ── Orchestrazione ────────────────────────────────────────────────────────

  async function refreshAll() {
    const spinner = $('loadingSpinner');
    spinner.classList.remove('d-none');
    clearAlert();

    try {
      // Il service tiene in memoria fino a un minuto di censimento: senza questo
      // la dashboard mostrerebbe dati vecchi senza dirlo.
      await fetch(SN_API + '/flush', { method: 'POST', credentials: 'same-origin' }).catch(() => {});

      const active = await loadStatus();
      if (!active) return;

      const days = $('windowDays').value || SN_DEFAULT_DAYS;
      await Promise.all([
        loadSummary(days),
        loadRules(),
        loadScanners(),
        loadFingerprints(),
        loadEvents(),
      ]);
    } catch (err) {
      showAlert('Errore nel caricamento dei dati: ' + err.message, 'danger');
    } finally {
      spinner.classList.add('d-none');
    }
  }

  function setupAutoRefresh() {
    if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
    if (!$('autoRefreshToggle').checked || SN_AUTO_REFRESH_SECONDS <= 0) return;
    autoRefreshTimer = setInterval(refreshAll, SN_AUTO_REFRESH_SECONDS * 1000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('btnRefresh').addEventListener('click', refreshAll);
    $('autoRefreshToggle').addEventListener('change', setupAutoRefresh);
    $('windowDays').addEventListener('change', refreshAll);
    $('enforcedOnlyToggle').addEventListener('change', loadEvents);
    $('btnToggleMode').addEventListener('click', toggleMode);

    refreshAll();
    setupAutoRefresh();
  });
})();
