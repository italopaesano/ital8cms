'use strict';

/* ─── Constants ─────────────────────────────────────────────────────────────── */

const DEFAULT_SALT = 'cambia-questo-salt-in-produzione-con-stringa-casuale';

const TAB_FIELDS = {
  privacy:     ['gdprCompliance', 'sessionSalt', 'useAnalyticsCookie', 'analyticsCookieName'],
  storage:     ['rotationMode', 'retentionDays', 'dataPath'],
  performance: ['flushIntervalSeconds'],
};

/* ─── State ──────────────────────────────────────────────────────────────────── */

let pendingTabTarget  = null;   // target tab id waiting for unsaved-changes confirmation
let generatedSaltValue = '';    // salt built in the modal, applied on confirm
const dirtyTabs = new Set();    // tab ids with unsaved changes

/* ─── Helpers ────────────────────────────────────────────────────────────────── */

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

/* ─── Alert area ─────────────────────────────────────────────────────────────── */

function showAlert(message, type = 'danger') {
  const area = document.getElementById('alertArea');
  if (!area) return;
  const div = document.createElement('div');
  div.className = `alert alert-${type} alert-dismissible fade show`;
  div.setAttribute('role', 'alert');
  div.innerHTML = `${escHtml(message)}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
  area.innerHTML = '';
  area.appendChild(div);
}

/* ─── Per-tab messages ───────────────────────────────────────────────────────── */

function showTabMessages(tabId, result) {
  const containerId = `tabMessages-${tabId}`;
  const container   = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  if (result.errors && result.errors.length > 0) {
    const ul = document.createElement('ul');
    ul.className = 'list-unstyled mb-0';
    result.errors.forEach(err => {
      const li = document.createElement('li');
      li.className = 'text-danger small';
      li.innerHTML = `<i class="bi bi-x-circle"></i> ${escHtml(err)}`;
      ul.appendChild(li);
    });
    const div = document.createElement('div');
    div.className = 'alert alert-danger py-2';
    div.appendChild(ul);
    container.appendChild(div);
  }

  if (result.warnings && result.warnings.length > 0) {
    const ul = document.createElement('ul');
    ul.className = 'list-unstyled mb-0';
    result.warnings.forEach(w => {
      const li = document.createElement('li');
      li.className = 'text-warning small';
      li.innerHTML = `<i class="bi bi-exclamation-triangle"></i> ${escHtml(w)}`;
      ul.appendChild(li);
    });
    const div = document.createElement('div');
    div.className = 'alert alert-warning py-2';
    div.appendChild(ul);
    container.appendChild(div);
  }
}

function clearTabMessages(tabId) {
  const el = document.getElementById(`tabMessages-${tabId}`);
  if (el) el.innerHTML = '';
}

/* ─── Textarea messages ──────────────────────────────────────────────────────── */

function showTextareaMessages(result) {
  const container = document.getElementById('textareaMessages');
  if (!container) return;
  container.innerHTML = '';

  if (result.errors && result.errors.length > 0) {
    const ul = document.createElement('ul');
    ul.className = 'list-unstyled mb-0';
    result.errors.forEach(err => {
      const li = document.createElement('li');
      li.className = 'text-danger small';
      li.innerHTML = `<i class="bi bi-x-circle"></i> ${escHtml(err)}`;
      ul.appendChild(li);
    });
    const div = document.createElement('div');
    div.className = 'alert alert-danger py-2';
    div.appendChild(ul);
    container.appendChild(div);
  }

  if (result.warnings && result.warnings.length > 0) {
    const ul = document.createElement('ul');
    ul.className = 'list-unstyled mb-0';
    result.warnings.forEach(w => {
      const li = document.createElement('li');
      li.className = 'text-warning small';
      li.innerHTML = `<i class="bi bi-exclamation-triangle"></i> ${escHtml(w)}`;
      ul.appendChild(li);
    });
    const div = document.createElement('div');
    div.className = 'alert alert-warning py-2';
    div.appendChild(ul);
    container.appendChild(div);
  }

  if (!result.errors?.length && !result.warnings?.length && result.valid) {
    const div = document.createElement('div');
    div.className = 'alert alert-success py-2 small';
    div.innerHTML = '<i class="bi bi-check-circle"></i> JSON5 valido.';
    container.appendChild(div);
  }
}

/* ─── Restart banner ─────────────────────────────────────────────────────────── */

function showRestartBanner() {
  const banner = document.getElementById('restartBanner');
  if (banner) banner.classList.remove('d-none');
}

/* ─── Dirty tracking ─────────────────────────────────────────────────────────── */

function markDirty(tabId) {
  dirtyTabs.add(tabId);
}

function clearDirty(tabId) {
  dirtyTabs.delete(tabId);
}

/* ─── Form ↔ data ────────────────────────────────────────────────────────────── */

function formToData() {
  return {
    gdprCompliance:       document.getElementById('gdprCompliance').checked,
    sessionSalt:          document.getElementById('sessionSalt').value,
    useAnalyticsCookie:   document.getElementById('useAnalyticsCookie').checked,
    analyticsCookieName:  document.getElementById('analyticsCookieName').value,
    rotationMode:         (document.querySelector('input[name="rotationMode"]:checked') || {}).value || 'none',
    retentionDays:        parseInt(document.getElementById('retentionDays').value, 10) || 0,
    dataPath:             document.getElementById('dataPath').value,
    flushIntervalSeconds: parseInt(document.getElementById('flushIntervalSeconds').value, 10) || 0,
  };
}

function dataToForm(data) {
  if (data.gdprCompliance !== undefined) {
    document.getElementById('gdprCompliance').checked = !!data.gdprCompliance;
  }
  if (data.sessionSalt !== undefined) {
    document.getElementById('sessionSalt').value = data.sessionSalt;
    checkDefaultSaltWarning();
  }
  if (data.useAnalyticsCookie !== undefined) {
    document.getElementById('useAnalyticsCookie').checked = !!data.useAnalyticsCookie;
    syncCookieName();
  }
  if (data.analyticsCookieName !== undefined) {
    document.getElementById('analyticsCookieName').value = data.analyticsCookieName;
  }
  if (data.rotationMode !== undefined) {
    const radio = document.querySelector(`input[name="rotationMode"][value="${data.rotationMode}"]`);
    if (radio) radio.checked = true;
  }
  if (data.retentionDays !== undefined) {
    document.getElementById('retentionDays').value = data.retentionDays;
  }
  if (data.dataPath !== undefined) {
    document.getElementById('dataPath').value = data.dataPath;
  }
  if (data.flushIntervalSeconds !== undefined) {
    document.getElementById('flushIntervalSeconds').value = data.flushIntervalSeconds;
    checkFlushIntervalWarning();
  }
}

/* ─── Cookie name sync ───────────────────────────────────────────────────────── */

function syncCookieName() {
  const useIt   = document.getElementById('useAnalyticsCookie').checked;
  const nameEl  = document.getElementById('analyticsCookieName');
  const warnEl  = document.getElementById('cookieGdprWarning');
  const gdpr    = document.getElementById('gdprCompliance').checked;

  nameEl.disabled = !useIt;

  if (warnEl) {
    if (useIt && gdpr) {
      warnEl.classList.remove('d-none');
    } else {
      warnEl.classList.add('d-none');
    }
  }
}

/* ─── Salt warning ───────────────────────────────────────────────────────────── */

function checkDefaultSaltWarning() {
  const val     = document.getElementById('sessionSalt').value;
  const warnEl  = document.getElementById('saltDefaultWarning');
  if (!warnEl) return;
  if (val === DEFAULT_SALT) {
    warnEl.classList.remove('d-none');
  } else {
    warnEl.classList.add('d-none');
  }
}

/* ─── Flush interval warning ─────────────────────────────────────────────────── */

function checkFlushIntervalWarning() {
  const val    = parseInt(document.getElementById('flushIntervalSeconds').value, 10) || 0;
  const warnEl = document.getElementById('flushIntervalWarning');
  if (!warnEl) return;
  if (val > 300) {
    warnEl.classList.remove('d-none');
  } else {
    warnEl.classList.add('d-none');
  }
}

/* ─── Salt visibility toggle ─────────────────────────────────────────────────── */

function toggleSaltVisibility() {
  const input = document.getElementById('sessionSalt');
  const icon  = document.getElementById('iconToggleSalt');
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'bi bi-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'bi bi-eye';
  }
}

/* ─── Salt generation ────────────────────────────────────────────────────────── */

function generateSalt() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  generatedSaltValue = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  const preview = document.getElementById('generatedSaltPreview');
  if (preview) preview.textContent = generatedSaltValue;
}

function doGenerateSalt() {
  if (!generatedSaltValue) return;
  document.getElementById('sessionSalt').value = generatedSaltValue;
  generatedSaltValue = '';
  checkDefaultSaltWarning();
  markDirty('privacy');
}

/* ─── Load settings from server ─────────────────────────────────────────────── */

async function loadSettings() {
  try {
    const res  = await fetch(`/${apiPrefix}/adminAnalytics/load-settings`);
    const body = await res.json();
    if (!body.success) {
      showAlert(body.error || 'Errore nel caricamento delle impostazioni.');
      return;
    }
    dataToForm(body.data);
    if (body.raw !== undefined) {
      const ta = document.getElementById('jsonEditor');
      if (ta) ta.value = body.raw;
    }
    dirtyTabs.clear();
  } catch (err) {
    showAlert('Errore di rete: ' + err.message);
  }
}

/* ─── Save a single tab ──────────────────────────────────────────────────────── */

async function saveTab(tabId) {
  const allData    = formToData();
  const fieldNames = TAB_FIELDS[tabId] || [];
  const tabData    = {};
  fieldNames.forEach(f => { tabData[f] = allData[f]; });

  clearTabMessages(tabId);

  try {
    const res  = await fetch(`/${apiPrefix}/adminAnalytics/save-settings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(tabData),
    });
    const body = await res.json();

    if (!body.success) {
      showTabMessages(tabId, { errors: body.errors || [body.error || 'Errore sconosciuto.'], warnings: body.warnings });
      return;
    }

    showTabMessages(tabId, { errors: [], warnings: body.warnings || [] });
    clearDirty(tabId);
    showRestartBanner();

    // Reload raw textarea to reflect saved state
    const rawRes  = await fetch(`/${apiPrefix}/adminAnalytics/load-settings`);
    const rawBody = await rawRes.json();
    if (rawBody.success && rawBody.raw !== undefined) {
      const ta = document.getElementById('jsonEditor');
      if (ta) ta.value = rawBody.raw;
    }
  } catch (err) {
    showTabMessages(tabId, { errors: ['Errore di rete: ' + err.message], warnings: [] });
  }
}

/* ─── Textarea validate ──────────────────────────────────────────────────────── */

async function validateTextarea() {
  const ta      = document.getElementById('jsonEditor');
  const content = ta ? ta.value : '';
  document.getElementById('textareaMessages').innerHTML = '';

  try {
    const res  = await fetch(`/${apiPrefix}/adminAnalytics/validate-settings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content }),
    });
    const body = await res.json();
    showTextareaMessages(body);
  } catch (err) {
    showTextareaMessages({ errors: ['Errore di rete: ' + err.message], warnings: [] });
  }
}

/* ─── Textarea save ──────────────────────────────────────────────────────────── */

async function saveFromTextarea() {
  const ta      = document.getElementById('jsonEditor');
  const content = ta ? ta.value : '';
  document.getElementById('textareaMessages').innerHTML = '';

  try {
    const res  = await fetch(`/${apiPrefix}/adminAnalytics/save-raw-settings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content }),
    });
    const body = await res.json();

    if (!body.success) {
      showTextareaMessages({ errors: body.errors || [body.error || 'Errore sconosciuto.'], warnings: body.warnings });
      return;
    }

    showTextareaMessages({ valid: true, errors: [], warnings: body.warnings || [] });
    dirtyTabs.clear();
    showRestartBanner();

    // Re-sync form fields from the newly saved config
    const loadRes  = await fetch(`/${apiPrefix}/adminAnalytics/load-settings`);
    const loadBody = await loadRes.json();
    if (loadBody.success) dataToForm(loadBody.data);
  } catch (err) {
    showTextareaMessages({ errors: ['Errore di rete: ' + err.message], warnings: [] });
  }
}

/* ─── Storage info ───────────────────────────────────────────────────────────── */

async function loadStorageInfo() {
  try {
    const res  = await fetch(`/${apiPrefix}/adminAnalytics/storage-info`);
    const body = await res.json();
    if (!body.success) return;

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    set('infoDataDir',    body.dataDir   || '—');
    set('infoFileCount',  body.fileCount !== undefined ? body.fileCount : '—');
    set('infoTotalSize',  body.totalBytes !== undefined ? formatBytes(body.totalBytes) : '—');
    set('infoOldestFile', body.oldestFile || '—');
    set('infoNewestFile', body.newestFile || '—');
  } catch (_) { /* silent */ }
}

/* ─── Tab switching (with unsaved-changes guard) ─────────────────────────────── */

function activeTabId() {
  const btn = document.querySelector('#settingsTabsDesktop .nav-link.active');
  if (!btn) return null;
  const target = btn.getAttribute('data-bs-target');
  return target ? target.replace('#tab-', '') : null;
}

function switchToTabImmediate(targetId) {
  // Desktop nav-tabs
  const btn = document.querySelector(`#settingsTabsDesktop [data-bs-target="#tab-${targetId}"]`);
  if (btn) {
    const tab = bootstrap.Tab.getOrCreateInstance(btn);
    tab.show();
  }
  // Mobile select
  const sel = document.getElementById('settingsTabsMobile');
  if (sel) sel.value = `tab-${targetId}`;
}

function switchToTab(targetId) {
  const current = activeTabId();
  if (current && dirtyTabs.has(current) && current !== targetId) {
    pendingTabTarget = targetId;
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modalUnsavedChanges'));
    modal.show();
    return;
  }
  switchToTabImmediate(targetId);
}

/* ─── Setup tab listeners ────────────────────────────────────────────────────── */

function setupTabListeners() {
  // Bootstrap tab shown event — load storage info when info tab activated
  document.getElementById('settingsTabsDesktop')?.addEventListener('show.bs.tab', (e) => {
    const target = e.target.getAttribute('data-bs-target');
    if (target === '#tab-info') loadStorageInfo();
  });

  // Intercept nav-tab clicks to check for dirty state
  document.querySelectorAll('#settingsTabsDesktop [data-bs-toggle="tab"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetId = btn.getAttribute('data-bs-target').replace('#tab-', '');
      const current  = activeTabId();
      if (current && dirtyTabs.has(current) && current !== targetId) {
        e.preventDefault();
        e.stopImmediatePropagation();
        pendingTabTarget = targetId;
        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modalUnsavedChanges'));
        modal.show();
      }
    });
  });
}

/* ─── Setup mobile select ────────────────────────────────────────────────────── */

function setupMobileSelect() {
  const sel = document.getElementById('settingsTabsMobile');
  if (!sel) return;
  sel.addEventListener('change', () => {
    const targetId = sel.value.replace('tab-', '');
    switchToTab(targetId);
  });
}

/* ─── Setup form listeners ───────────────────────────────────────────────────── */

function setupFormListeners() {
  // Privacy tab
  ['gdprCompliance', 'useAnalyticsCookie', 'sessionSalt', 'analyticsCookieName'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => markDirty('privacy'));
    el.addEventListener('input',  () => markDirty('privacy'));
  });

  document.getElementById('gdprCompliance')?.addEventListener('change', syncCookieName);
  document.getElementById('useAnalyticsCookie')?.addEventListener('change', syncCookieName);
  document.getElementById('sessionSalt')?.addEventListener('input', checkDefaultSaltWarning);

  // Storage tab
  document.querySelectorAll('input[name="rotationMode"]').forEach(el => {
    el.addEventListener('change', () => markDirty('storage'));
  });
  ['retentionDays', 'dataPath'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => markDirty('storage'));
    el.addEventListener('input',  () => markDirty('storage'));
  });

  // Performance tab
  const flushEl = document.getElementById('flushIntervalSeconds');
  if (flushEl) {
    flushEl.addEventListener('change', () => { markDirty('performance'); checkFlushIntervalWarning(); });
    flushEl.addEventListener('input',  () => { markDirty('performance'); checkFlushIntervalWarning(); });
  }
}

/* ─── Wire up buttons ────────────────────────────────────────────────────────── */

function setupButtons() {
  // Save per tab
  document.getElementById('btnSavePrivacy')?.addEventListener('click',     () => saveTab('privacy'));
  document.getElementById('btnSaveStorage')?.addEventListener('click',     () => saveTab('storage'));
  document.getElementById('btnSavePerformance')?.addEventListener('click', () => saveTab('performance'));

  // Textarea actions
  document.getElementById('btnValidateTextarea')?.addEventListener('click', validateTextarea);
  document.getElementById('btnSaveTextarea')?.addEventListener('click',     saveFromTextarea);

  // Salt
  document.getElementById('btnToggleSalt')?.addEventListener('click', toggleSaltVisibility);

  // Salt modal — generate preview when modal is about to be shown
  document.getElementById('modalGenerateSalt')?.addEventListener('show.bs.modal', generateSalt);
  document.getElementById('btnConfirmGenerateSalt')?.addEventListener('click', doGenerateSalt);

  // Unsaved changes modal — confirm switch
  document.getElementById('btnConfirmSwitchTab')?.addEventListener('click', () => {
    const modal = bootstrap.Modal.getInstance(document.getElementById('modalUnsavedChanges'));
    if (modal) modal.hide();
    if (pendingTabTarget) {
      const tabId = activeTabId();
      if (tabId) clearDirty(tabId);
      switchToTabImmediate(pendingTabTarget);
      pendingTabTarget = null;
    }
  });

  // Storage info refresh
  document.getElementById('btnRefreshInfo')?.addEventListener('click', loadStorageInfo);
}

/* ─── Init ───────────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {
  setupTabListeners();
  setupMobileSelect();
  setupFormListeners();
  setupButtons();
  await loadSettings();
});
