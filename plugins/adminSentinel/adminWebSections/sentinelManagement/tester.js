/**
 * tester.js — prova una richiesta contro le regole in vigore.
 *
 * La parte utile dell'interfaccia non è il verdetto ma la **traccia**: per ogni
 * condizione, atteso accanto a osservato. È l'unica forma in cui la risposta a
 * «perché questa regola non scatta?» si legge invece di doverla dedurre.
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

  function fmt(value) {
    if (value === undefined) return '<em>' + esc(t('absent')) + '</em>';
    if (value === null) return 'null';
    if (typeof value === 'string') return value === '' ? '<em>' + esc(t('blank')) + '</em>' : esc(value);
    return '<code>' + esc(JSON.stringify(value)) + '</code>';
  }

  function renderEntries(entries, depth) {
    const pad = 'sn-trace-' + Math.min(depth, 3);
    return entries.map((e) => {
      const mark = e.matched
        ? '<span class="text-success">✓</span>'
        : '<span class="text-danger">✗</span>';

      if (e.children) {
        return '<div class="' + pad + '">' + mark + ' <strong>' + esc(e.leaf) + '</strong>'
          + e.children.map((c) => renderEntries(c, depth + 1)).join('') + '</div>';
      }

      return '<div class="' + pad + '">' + mark + ' <strong>' + esc(e.leaf) + '</strong>: '
        + '<span class="text-muted">' + esc(t('expected')) + '</span> ' + fmt(e.expected)
        + ' <span class="text-muted">— ' + esc(t('observed')) + '</span> ' + fmt(e.actual)
        + '</div>';
    }).join('');
  }

  function render(result, verbose) {
    const s = result.subject;
    const out = [];

    out.push('<div class="mb-3 small">'
      + '<div><strong>' + esc(s.method) + ' ' + esc(s.path) + (s.query ? '?' + esc(s.query) : '') + '</strong></div>'
      + '<div class="text-muted">'
      + esc(t('subjectLine', { ip: s.ip, ext: s.extension || t('none') }))
      + '<code>' + esc(s.fp) + '</code>'
      + esc(t('familyLine', { family: s.fpClass.family, profile: s.fpClass.headerProfile }))
      + (s.fpClass.coherent
        ? esc(t('yes'))
        : '<span class="text-warning fw-bold">' + esc(t('no')) + '</span>')
      + '</div></div>');

    if (result.matched) {
      out.push('<div class="alert alert-success py-2">✓ <strong>' + esc(result.matched.ruleName) + '</strong>'
        + esc(t('matched')) + '<code>' + esc(result.matched.action) + '</code>'
        + ' <span class="text-muted">'
        + esc(t('categoryNote', { category: result.matched.category })) + '</span></div>');
    } else {
      out.push('<div class="alert alert-secondary py-2">' + esc(t('noMatch')) + '</div>');
    }

    const rows = verbose ? result.evaluated : result.evaluated.filter((r) => r.matched);
    for (const rule of rows) {
      const mark = rule.matched ? '✓' : '·';
      let note = '';
      if (rule.skipped) {
        note = ' <span class="badge bg-secondary">' + esc(t('skipped', { reason: rule.skipped })) + '</span>';
      } else if (rule.shortCircuited) {
        // A runtime queste non verrebbero nemmeno valutate: dirlo evita di far
        // credere che siano state scartate nel merito.
        note = ' <span class="badge bg-light text-dark">' + esc(t('afterWinner')) + '</span>';
      }

      out.push('<div class="sn-trace-rule ' + (rule.matched ? 'sn-trace-hit' : '') + '">'
        + '<div>' + mark + ' <code>' + esc(rule.ruleName) + '</code>'
        + ' <span class="text-muted small">' + esc(rule.action || '') + '</span>' + note + '</div>'
        + (rule.entries ? renderEntries(rule.entries, 0) : '')
        + '</div>');
    }

    if (rows.length === 0) {
      out.push('<div class="text-muted small">' + esc(t('verboseHint')) + '</div>');
    }

    $('testResult').innerHTML = out.join('');
  }

  async function run() {
    const box = $('testAlert');
    box.classList.add('d-none');

    const roles = ($('tRoles').value || '')
      .split(',').map((r) => parseInt(r.trim(), 10)).filter(Number.isInteger);

    const sessionAnomalies = Array.from($('tSessionAnomaly').selectedOptions).map((o) => o.value);

    const spec = {
      path: $('tPath').value.trim(),
      method: $('tMethod').value,
      ip: $('tIp').value.trim() || undefined,
      query: $('tQuery').value.trim() || undefined,
      headers: $('tUa').value.trim() ? { 'User-Agent': $('tUa').value.trim() } : {},
      // Le anomalie di sessione implicano l'autenticazione: a runtime esistono
      // solo lì, e lasciarle scegliere su una prova anonima farebbe credere che
      // la regola non scatti per un motivo diverso da quello vero.
      authenticated: $('tAuth').checked || roles.length > 0 || sessionAnomalies.length > 0,
      roleIds: roles,
      sessionAnomalies: sessionAnomalies,
      browserProfile: $('tBrowser').checked,
    };

    if (!spec.path) {
      box.className = 'alert alert-warning';
      box.textContent = t('pathRequired');
      box.classList.remove('d-none');
      return;
    }

    try {
      const res = await fetch(SN_API + '/rules/test', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec: spec }),
      });
      const data = await res.json();

      if (!data.ok) {
        box.className = 'alert alert-danger';
        box.textContent = data.error || t('unavailable');
        box.classList.remove('d-none');
        return;
      }
      render(data.result, $('tVerbose').checked);
    } catch (err) {
      box.className = 'alert alert-danger';
      box.textContent = t('networkError', { error: err.message });
      box.classList.remove('d-none');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('btnTest').addEventListener('click', run);
    $('tVerbose').addEventListener('change', run);
    $('tBrowser').addEventListener('change', run);
    $('tPath').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    run();
  });
})();
