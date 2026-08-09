/**
 * tester.js — prova una richiesta contro le regole in vigore.
 *
 * La parte utile dell'interfaccia non è il verdetto ma la **traccia**: per ogni
 * condizione, atteso accanto a osservato. È l'unica forma in cui la risposta a
 * «perché questa regola non scatta?» si legge invece di doverla dedurre.
 */

/* global SN_API, escapeHtml */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (v) => escapeHtml(v === null || v === undefined ? '' : String(v));

  function fmt(value) {
    if (value === undefined) return '<em>(assente)</em>';
    if (value === null) return 'null';
    if (typeof value === 'string') return value === '' ? '<em>(vuoto)</em>' : esc(value);
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
        + '<span class="text-muted">atteso</span> ' + fmt(e.expected)
        + ' <span class="text-muted">— osservato</span> ' + fmt(e.actual)
        + '</div>';
    }).join('');
  }

  function render(result, verbose) {
    const s = result.subject;
    const out = [];

    out.push('<div class="mb-3 small">'
      + '<div><strong>' + esc(s.method) + ' ' + esc(s.path) + (s.query ? '?' + esc(s.query) : '') + '</strong></div>'
      + '<div class="text-muted">ip: ' + esc(s.ip)
      + ' · estensione: ' + (s.extension ? esc(s.extension) : '<em>nessuna</em>')
      + ' · impronta: <code>' + esc(s.fp) + '</code>'
      + ' · famiglia: ' + esc(s.fpClass.family)
      + ' · profilo: ' + esc(s.fpClass.headerProfile)
      + ' · coerente: ' + (s.fpClass.coherent
        ? 'sì'
        : '<span class="text-warning fw-bold">no</span>')
      + '</div></div>');

    if (result.matched) {
      out.push('<div class="alert alert-success py-2">✓ <strong>' + esc(result.matched.ruleName) + '</strong>'
        + ' → action: <code>' + esc(result.matched.action) + '</code>'
        + ' <span class="text-muted">(categoria: ' + esc(result.matched.category) + ')</span></div>');
    } else {
      out.push('<div class="alert alert-secondary py-2">✗ Nessuna regola matcha: '
        + 'la richiesta passerebbe senza essere classificata.</div>');
    }

    const rows = verbose ? result.evaluated : result.evaluated.filter((r) => r.matched);
    for (const rule of rows) {
      const mark = rule.matched ? '✓' : '·';
      let note = '';
      if (rule.skipped) {
        note = ' <span class="badge bg-secondary">saltata: ' + esc(rule.skipped) + '</span>';
      } else if (rule.shortCircuited) {
        // A runtime queste non verrebbero nemmeno valutate: dirlo evita di far
        // credere che siano state scartate nel merito.
        note = ' <span class="badge bg-light text-dark">dopo la vincitrice</span>';
      }

      out.push('<div class="sn-trace-rule ' + (rule.matched ? 'sn-trace-hit' : '') + '">'
        + '<div>' + mark + ' <code>' + esc(rule.ruleName) + '</code>'
        + ' <span class="text-muted small">' + esc(rule.action || '') + '</span>' + note + '</div>'
        + (rule.entries ? renderEntries(rule.entries, 0) : '')
        + '</div>');
    }

    if (rows.length === 0) {
      out.push('<div class="text-muted small">Attiva «mostra anche le regole che non matchano» '
        + 'per vedere perché ciascuna è stata scartata.</div>');
    }

    $('testResult').innerHTML = out.join('');
  }

  async function run() {
    const box = $('testAlert');
    box.classList.add('d-none');

    const roles = ($('tRoles').value || '')
      .split(',').map((r) => parseInt(r.trim(), 10)).filter(Number.isInteger);

    const spec = {
      path: $('tPath').value.trim(),
      method: $('tMethod').value,
      ip: $('tIp').value.trim() || undefined,
      query: $('tQuery').value.trim() || undefined,
      headers: $('tUa').value.trim() ? { 'User-Agent': $('tUa').value.trim() } : {},
      authenticated: $('tAuth').checked || roles.length > 0,
      roleIds: roles,
      browserProfile: $('tBrowser').checked,
    };

    if (!spec.path) {
      box.className = 'alert alert-warning';
      box.textContent = 'Il percorso è obbligatorio.';
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
        box.textContent = data.error || 'Il filtro non è disponibile.';
        box.classList.remove('d-none');
        return;
      }
      render(data.result, $('tVerbose').checked);
    } catch (err) {
      box.className = 'alert alert-danger';
      box.textContent = 'Errore di rete: ' + err.message;
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
