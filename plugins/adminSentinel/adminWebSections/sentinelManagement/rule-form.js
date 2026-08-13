/**
 * rule-form.js — Vista C: le regole campo per campo.
 *
 * ─── LA REGOLA CHE HA DETERMINATO IL PROGETTO ─────────────────────────────────
 * Un form non deve MAI distruggere ciò che non sa rappresentare.
 *
 * L'albero `match` ammette combinatori annidati (`all` / `any` / `not`) che un
 * form piatto non può mostrare. La tentazione sarebbe appiattirli; il risultato
 * sarebbe che aprire una regola e salvarla senza toccare niente la cambia. Qui
 * invece un `match` non rappresentabile viene **conservato alla lettera** e
 * mostrato in sola lettura: si può modificare tutto il resto della regola e
 * salvare senza rischio.
 *
 * ─── COORDINAMENTO CON LA VISTA B ─────────────────────────────────────────────
 * Le due viste modificano lo STESSO file. Fonte di verità unica = il .json5 su
 * disco, validazione **lato server con il validatore del motore**, e nessuna
 * cache locale: si rilegge il file dopo ogni salvataggio.
 *
 * Il contenuto dinamico passa da escapeHtml() prima di finire in innerHTML: qui
 * si stampano nomi di regole e descrizioni, che restano contenuto scritto da
 * qualcuno.
 */

/* global SN_API, escapeHtml */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (v) => escapeHtml(v === null || v === undefined ? '' : String(v));

  /** Foglie che il form sa mostrare. Tutto il resto rende il match "complesso". */
  const SIMPLE_LEAVES = [
    'path', 'extension', 'method', 'userAgent', 'query', 'ip', 'status',
    'authenticated', 'roleIds', 'canary', 'sessionAnomaly', 'reputation',
    'fingerprintClass',
  ];

  const FP_CLASS_KEYS = ['coherent', 'family', 'headerProfile', 'claimedOs'];

  let rules = [];
  let current = null;      // la regola come sta sul file
  let dirty = false;

  // ── Utility ───────────────────────────────────────────────────────────────

  function alertBox(message, kind) {
    const box = $('formAlert');
    box.className = 'alert alert-' + (kind || 'danger');
    box.textContent = message;
    box.classList.remove('d-none');
    if (kind === 'success') setTimeout(() => box.classList.add('d-none'), 4000);
  }

  const clearAlert = () => $('formAlert').classList.add('d-none');

  /** "a, b , c" → ["a","b","c"]; vuoto → undefined (la chiave sparisce). */
  function listOf(value) {
    const parts = String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
    return parts.length ? parts : undefined;
  }

  function intListOf(value) {
    const parts = String(value || '').split(',')
      .map((s) => parseInt(s.trim(), 10)).filter(Number.isInteger);
    return parts.length ? parts : undefined;
  }

  function linesOf(value) {
    const parts = String(value || '').split('\n').map((s) => s.trim()).filter(Boolean);
    return parts.length ? parts : undefined;
  }

  /** Un array di un solo elemento torna scalare: com'è più naturale scriverlo. */
  const collapse = (arr) => (Array.isArray(arr) && arr.length === 1 ? arr[0] : arr);

  // ── Le due mappature che hanno perso dati ─────────────────────────────────
  // Estratte come funzioni PURE perché è qui che il form ha distrutto due volte
  // ciò che non sapeva rappresentare, ed è l'unica parte che si possa mettere
  // sotto test senza un DOM. Vedi ruleFormMapping.test.js.

  // Valore sentinella della voce «qualunque» nei due multi-select. Non può
  // collidere con un valore vero: le anomalie sono nomi (uaChanged, …) e i
  // livelli di reputazione anche (burst, suspect, bad).
  const ANY = '*';

  /**
   * `true` (= qualunque) ⇄ voce sentinella; array ⇄ sé stesso.
   * Senza la voce sentinella la forma booleana si presentava come «niente
   * selezionato», e alla prima risalvata la chiave spariva del tutto: una regola
   * `{ sessionAnomaly: true, path: '/admin/**' }` diventava `{ path: '/admin/**' }`
   * — da «solo le sessioni anomale» a «tutte».
   */
  function anyOrListToSelection(value) {
    if (value === true) return [ANY];
    return asArray(value);
  }

  /** Il verso opposto: `['*']` → true, `[]` → undefined (la chiave sparisce). */
  function selectionToAnyOrList(values) {
    const scelti = asArray(values);
    if (scelti.indexOf(ANY) !== -1) return true;   // il più largo vince
    return scelti.length ? scelti : undefined;
  }

  /**
   * Pattern multipli in un'area di testo, UNO PER RIGA.
   *
   * Non separati da virgola come extension/method/ip, perché lì la virgola non
   * può comparire dentro un valore mentre in una querystring è un carattere
   * normale (`?ids=1,2,3`): separare per virgola spezzerebbe in due un pattern
   * singolo che ne contiene una. Prima il campo era una riga sola e un valore
   * array vi finiva schiacciato da `String(...)`, per poi tornare sul file come
   * l'unica stringa improbabile `"a,b"`.
   */
  const patternsToText = (value) => asArray(value).join('\n');

  function textToPatterns(text) {
    const righe = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (righe.length === 0) return undefined;
    return collapse(righe);
  }

  /** Il match è rappresentabile dal form? */
  function isSimpleMatch(match) {
    if (!match || typeof match !== 'object') return false;
    return Object.keys(match).every((k) => SIMPLE_LEAVES.indexOf(k) !== -1);
  }

  const asArray = (v) => (v === undefined ? [] : (Array.isArray(v) ? v : [v]));

  function setMulti(select, values) {
    const wanted = asArray(values);
    for (const option of select.options) option.selected = wanted.indexOf(option.value) !== -1;
  }

  const getMulti = (select) => Array.from(select.selectedOptions).map((o) => o.value);

  // ── Elenco ────────────────────────────────────────────────────────────────

  async function loadRules() {
    const res = await fetch(SN_API + '/rules/source', { credentials: 'same-origin' });
    const data = await res.json();
    rules = data.rules || [];

    const list = $('ruleList');
    if (rules.length === 0) {
      list.innerHTML = '<div class="list-group-item text-muted small">Nessuna regola nel file.</div>';
      return;
    }

    list.innerHTML = rules.map(function (r, i) {
      const spenta = r.enabled === false ? ' text-muted' : '';
      const tono = r.action === 'monitor' || r.action === 'allow' ? 'bg-secondary' : 'bg-danger';
      return '<button type="button" class="list-group-item list-group-item-action' + spenta + '" data-index="' + i + '">'
        + '<div class="d-flex justify-content-between align-items-center">'
        + '<code>' + esc(r.name) + '</code>'
        + '<span class="badge ' + tono + '">' + esc(r.action) + '</span>'
        + '</div>'
        + '<div class="small text-muted">' + esc(r.category || '—') + '</div>'
        + '</button>';
    }).join('');

    Array.from(list.querySelectorAll('button')).forEach(function (btn) {
      btn.addEventListener('click', function () { select(parseInt(btn.dataset.index, 10)); });
    });
  }

  function select(index) {
    // Uscire da una regola modificata senza salvare è il modo più facile di
    // perdere lavoro in una GUI a due pannelli: si chiede conferma.
    if (dirty && !window.confirm('Ci sono modifiche non salvate su questa regola. Vuoi abbandonarle?')) return;
    current = rules[index];
    fill(current, index);
  }

  // ── Popolamento ───────────────────────────────────────────────────────────

  function fill(rule, index) {
    clearAlert();
    $('emptyCard').style.display = 'none';
    $('formCard').style.display = '';

    $('fName').textContent = rule.name;
    $('fPosition').textContent = 'posizione ' + (index + 1) + ' di ' + rules.length;
    $('fCategory').value = rule.category || '';
    $('fDescription').value = rule.description || '';
    $('fAppliesTo').value = rule.appliesTo || 'any';
    $('fEnabled').checked = rule.enabled !== false;
    $('fAction').value = rule.action || 'monitor';

    const esc8 = rule.escalate || {};
    $('fEscalateRule').value = esc8.rateLimiterRule || '';
    $('fEscalateBan').checked = esc8.ban === true;
    $('fEscalateSeconds').value = esc8.banSeconds || '';

    renderActionParams(rule);
    fillMatch(rule.match);

    dirty = false;
  }

  function renderActionParams(rule) {
    const action = $('fAction').value;
    const box = $('actionParams');
    const decoy = rule && rule.decoy ? rule.decoy : {};
    const redirect = rule && rule.redirect ? rule.redirect : {};
    const tarpit = rule && rule.tarpit ? rule.tarpit : {};

    if (action === 'decoy') {
      box.innerHTML = '<div class="row g-2">'
        + '<div class="col-7"><label class="form-label small mb-1">decoy.file</label>'
        + '<input id="pDecoyFile" class="form-control form-control-sm" value="' + esc(decoy.file || '') + '"></div>'
        + '<div class="col-5"><label class="form-label small mb-1">status</label>'
        + '<input id="pDecoyStatus" type="number" class="form-control form-control-sm" value="' + esc(decoy.status || 200) + '"></div>'
        + '</div>';
    } else if (action === 'redirect') {
      box.innerHTML = '<div class="row g-2">'
        + '<div class="col-8"><label class="form-label small mb-1">redirect.to</label>'
        + '<input id="pRedirectTo" class="form-control form-control-sm" value="' + esc(redirect.to || '') + '"></div>'
        + '<div class="col-4"><label class="form-label small mb-1">status</label>'
        + '<input id="pRedirectStatus" type="number" class="form-control form-control-sm" value="' + esc(redirect.status || 302) + '"></div>'
        + '</div>';
    } else if (action === 'tarpit') {
      box.innerHTML = '<label class="form-label small mb-1">tarpit.seconds</label>'
        + '<input id="pTarpitSeconds" type="number" min="1" class="form-control form-control-sm" '
        + 'placeholder="default (custom.tarpit.maxSeconds)" value="' + esc(tarpit.seconds || '') + '">';
    } else {
      box.innerHTML = '';
    }
    Array.from(box.querySelectorAll('input')).forEach(markDirtyOn);
  }

  function fillMatch(match) {
    const semplice = isSimpleMatch(match);
    $('matchSimple').classList.toggle('d-none', !semplice);
    $('matchComplex').classList.toggle('d-none', semplice);

    if (!semplice) {
      $('matchPreview').textContent = JSON.stringify(match, null, 2);
      return;
    }

    const m = match || {};
    $('mPath').value = asArray(m.path).join('\n');
    $('mExtension').value = asArray(m.extension).join(', ');
    $('mMethod').value = asArray(m.method).join(', ');
    $('mUserAgent').value = Array.isArray(m.userAgent) ? m.userAgent.join(', ') : (m.userAgent || '');
    $('mQuery').value = patternsToText(m.query);
    $('mIp').value = asArray(m.ip).join(', ');
    $('mStatus').value = asArray(m.status).join(', ');
    $('mRoleIds').value = asArray(m.roleIds).join(', ');
    $('mAuthenticated').value = m.authenticated === undefined ? '' : String(m.authenticated);
    $('mCanary').value = m.canary === undefined ? '' : String(m.canary);
    setMulti($('mSessionAnomaly'), anyOrListToSelection(m.sessionAnomaly));
    setMulti($('mReputation'), anyOrListToSelection(m.reputation));

    const fp = m.fingerprintClass || {};
    $('mFpCoherent').value = fp.coherent === undefined ? '' : String(fp.coherent);
    $('mFpFamily').value = fp.family || '';
    $('mFpProfile').value = fp.headerProfile || '';
    $('mFpOs').value = fp.claimedOs || '';
  }

  // ── Raccolta ──────────────────────────────────────────────────────────────

  function collectMatch() {
    // Match non rappresentabile: si restituisce l'originale ALLA LETTERA. È la
    // ragione per cui salvare una regola complessa dal form è sicuro.
    if (!isSimpleMatch(current.match)) return current.match;

    const m = {};
    const path = linesOf($('mPath').value);
    if (path) m.path = collapse(path);
    const ext = listOf($('mExtension').value);
    if (ext) m.extension = ext;
    const method = listOf($('mMethod').value);
    if (method) m.method = method;

    const ua = String($('mUserAgent').value || '').trim();
    if (ua) m.userAgent = ua.indexOf('regex:') === 0 || ua === 'empty' ? ua : collapse(listOf(ua));

    const query = textToPatterns($('mQuery').value);
    if (query !== undefined) m.query = query;
    const ip = listOf($('mIp').value);
    if (ip) m.ip = ip;
    const status = intListOf($('mStatus').value);
    if (status) m.status = status;
    const roleIds = intListOf($('mRoleIds').value);
    if (roleIds) m.roleIds = roleIds;

    if ($('mAuthenticated').value) m.authenticated = $('mAuthenticated').value === 'true';
    if ($('mCanary').value) m.canary = $('mCanary').value === 'true' ? true : $('mCanary').value;

    const anomalie = selectionToAnyOrList(getMulti($('mSessionAnomaly')));
    if (anomalie !== undefined) m.sessionAnomaly = anomalie;
    const reputazione = selectionToAnyOrList(getMulti($('mReputation')));
    if (reputazione !== undefined) m.reputation = reputazione;

    const fp = {};
    if ($('mFpCoherent').value) fp.coherent = $('mFpCoherent').value === 'true';
    if ($('mFpFamily').value.trim()) fp.family = $('mFpFamily').value.trim();
    if ($('mFpProfile').value.trim()) fp.headerProfile = $('mFpProfile').value.trim();
    if ($('mFpOs').value.trim()) fp.claimedOs = $('mFpOs').value.trim();
    if (Object.keys(fp).length) m.fingerprintClass = fp;

    return m;
  }

  function collect() {
    const action = $('fAction').value;
    const rule = {
      name: current.name,
      enabled: $('fEnabled').checked,
      action: action,
      match: collectMatch(),
    };

    const category = $('fCategory').value.trim();
    if (category) rule.category = category;
    const description = $('fDescription').value.trim();
    if (description) rule.description = description;
    const appliesTo = $('fAppliesTo').value;
    if (appliesTo && appliesTo !== 'any') rule.appliesTo = appliesTo;

    if (action === 'decoy' && $('pDecoyFile')) {
      rule.decoy = { file: $('pDecoyFile').value.trim() };
      const status = parseInt($('pDecoyStatus').value, 10);
      if (Number.isInteger(status)) rule.decoy.status = status;
      // Gli header dichiarati dal decoy non sono nel form: si conservano.
      if (current.decoy && current.decoy.headers) rule.decoy.headers = current.decoy.headers;
    } else if (action === 'redirect' && $('pRedirectTo')) {
      rule.redirect = { to: $('pRedirectTo').value.trim() };
      const status = parseInt($('pRedirectStatus').value, 10);
      if (Number.isInteger(status)) rule.redirect.status = status;
    } else if (action === 'tarpit' && $('pTarpitSeconds')) {
      const seconds = parseFloat($('pTarpitSeconds').value);
      if (seconds > 0) rule.tarpit = { seconds: seconds };
    }

    const escalateRule = $('fEscalateRule').value.trim();
    if (escalateRule) {
      rule.escalate = { rateLimiterRule: escalateRule };
      if ($('fEscalateBan').checked) rule.escalate.ban = true;
      const seconds = parseInt($('fEscalateSeconds').value, 10);
      if (Number.isInteger(seconds) && seconds > 0) rule.escalate.banSeconds = seconds;
    }

    return rule;
  }

  // ── Salvataggio ───────────────────────────────────────────────────────────

  async function save() {
    clearAlert();
    const rule = collect();

    const res = await fetch(SN_API + '/rules/fields', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleName: current.name, rule: rule }),
    });
    const data = await res.json();

    if (!data.ok) {
      const dettaglio = (data.errors && data.errors.length) ? data.errors.join(' · ') : data.error;
      alertBox('Non salvata: ' + dettaglio, 'danger');
      return;
    }

    dirty = false;
    const avvisi = (data.warnings && data.warnings.length)
      ? ' Avvisi: ' + data.warnings.join(' · ')
      : '';
    alertBox('Regola salvata e ricaricata nel motore.' + avvisi, avvisi ? 'warning' : 'success');

    // Si rilegge il file invece di fidarsi di ciò che si è appena inviato: è
    // l'unico modo di mostrare cosa c'è davvero su disco dopo la scrittura.
    const nome = current.name;
    await loadRules();
    const index = rules.findIndex((r) => r.name === nome);
    if (index !== -1) { current = rules[index]; fill(current, index); }
  }

  // ── Avvio ─────────────────────────────────────────────────────────────────

  function markDirtyOn(el) {
    el.addEventListener('input', () => { dirty = true; });
    el.addEventListener('change', () => { dirty = true; });
  }

  // ── Esportazione per i test ───────────────────────────────────────────────
  // Le quattro funzioni qui sotto sono pure e sono ESATTAMENTE il punto in cui il
  // form ha perso dati due volte. In browser `module` non esiste e questo ramo
  // non gira; sotto Node permette di verificare il giro completo file → form →
  // file senza allestire un DOM, che questo progetto non fa da nessuna parte.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ANY, anyOrListToSelection, selectionToAnyOrList, patternsToText, textToPatterns };
  }

  // Sotto Node non c'è un `document` da agganciare: il file viene richiesto solo
  // per le funzioni pure qui sopra.
  if (typeof document === 'undefined') return;

  document.addEventListener('DOMContentLoaded', function () {
    Array.from(document.querySelectorAll('#formCard input, #formCard select, #formCard textarea'))
      .forEach(markDirtyOn);

    $('fAction').addEventListener('change', function () { renderActionParams(current || {}); });
    $('btnSave').addEventListener('click', save);
    $('btnReload').addEventListener('click', async function () {
      const nome = current && current.name;
      await loadRules();
      const index = rules.findIndex((r) => r.name === nome);
      if (index !== -1) { current = rules[index]; fill(current, index); }
    });

    window.addEventListener('beforeunload', function (e) {
      if (!dirty) return undefined;
      e.preventDefault();
      e.returnValue = '';
      return '';
    });

    loadRules().catch(function (err) { alertBox('Caricamento fallito: ' + err.message, 'danger'); });
  });
}());
