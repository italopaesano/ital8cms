/**
 * media.js — adminMedia client-side logic
 *
 * Handles: folder tree, file listing/grid/list, upload with progress,
 * rename, move, delete, copy URL, pagination, filter, sort.
 *
 * Reads globals injected by index.ejs:
 *   MEDIA_API_PREFIX  — e.g. '/api/adminMedia'
 *   MEDIA_URL_BASE    — e.g. '/media'
 *   ITEMS_PER_PAGE    — e.g. 50
 */

/* ══ State ══════════════════════════════════════════════════════════════════ */
const state = {
  currentPath:  '',          // current folder (relative to media root)
  allEntries:   [],          // all entries loaded from server (unfiltered)
  filter:       'all',       // 'all' | 'image' | 'video' | 'audio'
  sort:         'name',      // 'name' | 'modified' | 'size' | 'category'
  sortAsc:      true,
  viewMode:     'grid',      // 'grid' | 'list'
  page:         1,
  itemsPerPage: ITEMS_PER_PAGE,

  // Modal context
  renameTarget: null,        // { path, type }
  deleteFileTarget: null,    // relative path string
  deleteFolderTarget: null,  // { path, recursive }
  moveTarget: null,          // relative path string
  moveDestPath: null,        // chosen destination folder
};

/* ══ Helpers ════════════════════════════════════════════════════════════════ */

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function categoryIcon(entry) {
  if (entry.type === 'folder') return '<i class="bi bi-folder-fill text-warning"></i>';
  if (entry.category === 'image') return '<i class="bi bi-image text-primary"></i>';
  if (entry.category === 'video') return '<i class="bi bi-camera-video text-danger"></i>';
  if (entry.category === 'audio') return '<i class="bi bi-music-note-beamed text-success"></i>';
  return '<i class="bi bi-file-earmark"></i>';
}

function filePublicUrl(relPath, name) {
  const filePath = relPath ? `${relPath}/${name}` : name;
  return `${MEDIA_URL_BASE}/${filePath}`;
}

function showWarning(msg, type = 'warning') {
  const area = document.getElementById('warningArea');
  const div = document.createElement('div');
  div.className = `alert alert-${type} alert-dismissible fade show small`;
  div.innerHTML = `${escHtml(msg)}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
  area.prepend(div);
}

function clearWarnings() {
  document.getElementById('warningArea').innerHTML = '';
}

async function apiGet(path) {
  const r = await fetch(MEDIA_API_PREFIX + path);
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(MEDIA_API_PREFIX + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

/* ══ Folder Tree ════════════════════════════════════════════════════════════ */

async function loadTree() {
  const data = await apiGet('/tree');
  renderTree(data);
}

function renderTree(nodes) {
  const container = document.getElementById('folderTree');
  container.innerHTML = '';

  // Root label
  const root = document.createElement('div');
  root.className = 'tree-root-label' + (state.currentPath === '' ? ' active' : '');
  root.innerHTML = '<i class="bi bi-folder2-open me-1"></i> / (root)';
  root.addEventListener('click', () => navigateTo(''));
  container.appendChild(root);

  // Recursive render
  if (nodes.length) {
    const childrenDiv = document.createElement('div');
    childrenDiv.className = 'tree-children';
    nodes.forEach(node => childrenDiv.appendChild(buildTreeNode(node)));
    container.appendChild(childrenDiv);
  }
}

function buildTreeNode(node) {
  const wrap = document.createElement('div');

  const item = document.createElement('div');
  item.className = 'tree-item' + (state.currentPath === node.path ? ' active' : '');
  item.dataset.path = node.path;

  const hasChildren = node.children && node.children.length > 0;
  item.innerHTML =
    `<span class="tree-toggle">${hasChildren ? '<i class="bi bi-chevron-right" data-expand></i>' : ''}</span>` +
    `<i class="bi bi-folder-fill tree-icon"></i>` +
    `<span class="tree-label">${escHtml(node.name)}</span>`;

  item.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateTo(node.path);
  });

  wrap.appendChild(item);

  if (hasChildren) {
    const childrenDiv = document.createElement('div');
    childrenDiv.className = 'tree-children';
    childrenDiv.style.display = 'none'; // collapsed by default
    node.children.forEach(child => childrenDiv.appendChild(buildTreeNode(child)));
    wrap.appendChild(childrenDiv);

    // Toggle expand/collapse
    item.querySelector('[data-expand]').addEventListener('click', (e) => {
      e.stopPropagation();
      const icon = e.currentTarget;
      const isOpen = childrenDiv.style.display !== 'none';
      childrenDiv.style.display = isOpen ? 'none' : '';
      icon.className = isOpen ? 'bi bi-chevron-right' : 'bi bi-chevron-down';
    });
  }

  return wrap;
}

/* ══ Navigation ═════════════════════════════════════════════════════════════ */

async function navigateTo(relPath) {
  state.currentPath = relPath;
  state.page = 1;
  clearWarnings();
  await loadDirectory();
  renderBreadcrumb();
  // Refresh tree to highlight current
  loadTree();
}

function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  const parts = state.currentPath ? state.currentPath.split('/') : [];
  let html = `<li class="breadcrumb-item"><a href="#" data-path="" class="bc-link">root</a></li>`;
  let cumulative = '';
  parts.forEach((part, i) => {
    cumulative = cumulative ? `${cumulative}/${part}` : part;
    const isLast = i === parts.length - 1;
    if (isLast) {
      html += `<li class="breadcrumb-item active">${escHtml(part)}</li>`;
    } else {
      const p = cumulative;
      html += `<li class="breadcrumb-item"><a href="#" data-path="${escHtml(p)}" class="bc-link">${escHtml(part)}</a></li>`;
    }
  });
  bc.innerHTML = html;
  bc.querySelectorAll('.bc-link').forEach(a => {
    a.addEventListener('click', (e) => { e.preventDefault(); navigateTo(a.dataset.path); });
  });
}

/* ══ Directory Listing ══════════════════════════════════════════════════════ */

async function loadDirectory() {
  const data = await apiGet(`/list?path=${encodeURIComponent(state.currentPath)}`);
  if (data.error) { showWarning(data.error, 'danger'); return; }
  state.allEntries = data.entries || [];
  renderFiles();
}

function getFilteredSorted() {
  let entries = state.allEntries.slice();

  // Filter (folders always visible)
  if (state.filter !== 'all') {
    entries = entries.filter(e => e.type === 'folder' || e.category === state.filter);
  }

  // Sort
  entries.sort((a, b) => {
    // Folders always first
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    let va, vb;
    switch (state.sort) {
      case 'modified': va = a.modified; vb = b.modified; break;
      case 'size':     va = a.size || 0; vb = b.size || 0; break;
      case 'category': va = a.category; vb = b.category; break;
      default:         va = a.name.toLowerCase(); vb = b.name.toLowerCase();
    }
    if (va < vb) return state.sortAsc ? -1 : 1;
    if (va > vb) return state.sortAsc ? 1 : -1;
    return 0;
  });

  return entries;
}

function renderFiles() {
  const entries = getFilteredSorted();
  const total = entries.length;

  // Pagination
  const totalPages = Math.ceil(total / state.itemsPerPage) || 1;
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * state.itemsPerPage;
  const pageEntries = entries.slice(start, start + state.itemsPerPage);

  document.getElementById('itemsCount').textContent = `${total} item${total !== 1 ? 's' : ''}`;

  const area = document.getElementById('fileArea');
  area.className = state.viewMode === 'grid' ? 'grid-view' : 'list-view';

  if (total === 0) {
    area.innerHTML = '<div class="text-muted text-center py-5"><i class="bi bi-inbox fs-1 d-block mb-2"></i>This folder is empty.</div>';
    document.getElementById('paginationNav').style.display = 'none';
    return;
  }

  if (state.viewMode === 'grid') {
    area.innerHTML = renderGrid(pageEntries);
  } else {
    area.innerHTML = renderTable(pageEntries);
  }

  bindFileEvents(area);
  renderPagination(total, totalPages);
}

/* ── Grid view ──────────────────────────────────────────────────────────── */
function renderGrid(entries) {
  const cards = entries.map(entry => {
    const relPath = state.currentPath ? `${state.currentPath}/${entry.name}` : entry.name;
    const isFolder = entry.type === 'folder';
    let thumbHtml;
    if (isFolder) {
      thumbHtml = `<div class="media-card-icon"><i class="bi bi-folder-fill"></i></div>`;
    } else if (entry.category === 'image') {
      const url = escHtml(filePublicUrl(state.currentPath, entry.name));
      thumbHtml = `<img class="media-card-thumb" src="${url}" alt="${escHtml(entry.name)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` +
                  `<div class="media-card-icon" style="display:none"><i class="bi bi-image-fill text-secondary"></i></div>`;
    } else {
      const icon = entry.category === 'video' ? 'bi-camera-video-fill text-danger' : 'bi-music-note-beamed text-success';
      thumbHtml = `<div class="media-card-icon"><i class="bi ${icon}"></i></div>`;
    }

    const actionsHtml = isFolder ? `
      <button class="btn btn-light btn-action" data-action="rename" data-path="${escHtml(relPath)}" data-type="folder" title="Rename"><i class="bi bi-pencil"></i></button>
      <button class="btn btn-light btn-action" data-action="deleteFolder" data-path="${escHtml(relPath)}" data-name="${escHtml(entry.name)}" title="Delete"><i class="bi bi-trash text-danger"></i></button>
    ` : `
      <button class="btn btn-light btn-action" data-action="copyUrl" data-path="${escHtml(relPath)}" title="Copy URL"><i class="bi bi-clipboard"></i></button>
      <button class="btn btn-light btn-action" data-action="rename" data-path="${escHtml(relPath)}" data-type="file" title="Rename"><i class="bi bi-pencil"></i></button>
      <button class="btn btn-light btn-action" data-action="move" data-path="${escHtml(relPath)}" data-name="${escHtml(entry.name)}" title="Move"><i class="bi bi-arrows-move"></i></button>
      <button class="btn btn-light btn-action" data-action="deleteFile" data-path="${escHtml(relPath)}" data-name="${escHtml(entry.name)}" title="Delete"><i class="bi bi-trash text-danger"></i></button>
    `;

    const clickAttr = isFolder ? `data-action="openFolder" data-path="${escHtml(relPath)}"` : '';

    return `
      <div class="media-card-wrap">
        <div class="media-card${isFolder ? ' is-folder' : ''}" ${clickAttr} style="${isFolder ? 'cursor:pointer' : ''}">
          ${thumbHtml}
          <div class="media-card-info">
            <div class="media-card-name" title="${escHtml(entry.name)}">${escHtml(entry.name)}</div>
            <div class="media-card-meta">${fmt(entry.size)} · ${isFolder ? 'folder' : entry.category}</div>
          </div>
        </div>
        <div class="media-card-actions">${actionsHtml}</div>
      </div>
    `;
  }).join('');

  return `<div class="media-grid">${cards}</div>`;
}

/* ── List / table view ──────────────────────────────────────────────────────*/
function renderTable(entries) {
  const rows = entries.map(entry => {
    const relPath = state.currentPath ? `${state.currentPath}/${entry.name}` : entry.name;
    const isFolder = entry.type === 'folder';
    let thumbCell;
    if (isFolder) {
      thumbCell = `<i class="bi bi-folder-fill text-warning file-icon"></i>`;
    } else if (entry.category === 'image') {
      const url = escHtml(filePublicUrl(state.currentPath, entry.name));
      thumbCell = `<img class="file-thumb" src="${url}" alt="${escHtml(entry.name)}" loading="lazy">`;
    } else {
      const icon = entry.category === 'video' ? 'bi-camera-video-fill text-danger' : 'bi-music-note-beamed text-success';
      thumbCell = `<i class="bi ${icon} file-icon"></i>`;
    }

    const actionsHtml = isFolder ? `
      <button class="btn btn-outline-secondary btn-sm btn-action me-1" data-action="rename" data-path="${escHtml(relPath)}" data-type="folder">Rename</button>
      <button class="btn btn-outline-danger btn-sm btn-action" data-action="deleteFolder" data-path="${escHtml(relPath)}" data-name="${escHtml(entry.name)}">Delete</button>
    ` : `
      <button class="btn btn-outline-secondary btn-sm btn-action me-1" data-action="copyUrl" data-path="${escHtml(relPath)}"><i class="bi bi-clipboard"></i></button>
      <button class="btn btn-outline-secondary btn-sm btn-action me-1" data-action="rename" data-path="${escHtml(relPath)}" data-type="file">Rename</button>
      <button class="btn btn-outline-secondary btn-sm btn-action me-1" data-action="move" data-path="${escHtml(relPath)}" data-name="${escHtml(entry.name)}">Move</button>
      <button class="btn btn-outline-danger btn-sm btn-action" data-action="deleteFile" data-path="${escHtml(relPath)}" data-name="${escHtml(entry.name)}">Delete</button>
    `;

    const nameCell = isFolder
      ? `<a href="#" class="text-decoration-none fw-semibold btn-action" data-action="openFolder" data-path="${escHtml(relPath)}">${escHtml(entry.name)}</a>`
      : escHtml(entry.name);

    return `<tr>
      <td style="width:44px">${thumbCell}</td>
      <td>${nameCell}</td>
      <td>${escHtml(isFolder ? 'Folder' : entry.category)}</td>
      <td>${fmt(entry.size)}</td>
      <td>${fmtDate(entry.modified)}</td>
      <td style="white-space:nowrap">${actionsHtml}</td>
    </tr>`;
  }).join('');

  return `<div class="media-table-wrap table-responsive">
    <table class="table table-sm table-hover media-table mb-0">
      <thead><tr>
        <th></th><th>Name</th><th>Type</th><th>Size</th><th>Modified</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/* ── Bind events on rendered file elements ─────────────────────────────── */
function bindFileEvents(area) {
  area.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = el.dataset.action;
      const fPath  = el.dataset.path;
      const fName  = el.dataset.name || (fPath ? fPath.split('/').pop() : '');

      switch (action) {
        case 'openFolder': navigateTo(fPath); break;
        case 'copyUrl':    copyUrl(fPath); break;
        case 'rename':     openRenameModal(fPath, el.dataset.type); break;
        case 'move':       openMoveModal(fPath, fName); break;
        case 'deleteFile': openDeleteFileModal(fPath, fName); break;
        case 'deleteFolder': openDeleteFolderModal(fPath, fName); break;
      }
    });
  });
}

/* ══ Pagination ═════════════════════════════════════════════════════════════ */
function renderPagination(total, totalPages) {
  const nav = document.getElementById('paginationNav');
  const ul  = document.getElementById('pagination');
  if (totalPages <= 1) { nav.style.display = 'none'; return; }
  nav.style.display = '';

  let html = '';
  html += `<li class="page-item${state.page === 1 ? ' disabled' : ''}">
    <a class="page-link" href="#" data-page="${state.page - 1}">&laquo;</a></li>`;
  for (let p = 1; p <= totalPages; p++) {
    html += `<li class="page-item${p === state.page ? ' active' : ''}">
      <a class="page-link" href="#" data-page="${p}">${p}</a></li>`;
  }
  html += `<li class="page-item${state.page === totalPages ? ' disabled' : ''}">
    <a class="page-link" href="#" data-page="${state.page + 1}">&raquo;</a></li>`;
  ul.innerHTML = html;

  ul.querySelectorAll('[data-page]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const p = parseInt(a.dataset.page);
      if (p < 1 || p > totalPages) return;
      state.page = p;
      renderFiles();
    });
  });
}

/* ══ Upload ═════════════════════════════════════════════════════════════════ */

function handleUpload(files) {
  if (!files || files.length === 0) return;
  clearWarnings();

  const progressArea = document.getElementById('uploadProgressArea');
  progressArea.style.display = '';
  progressArea.innerHTML = '';

  const formData = new FormData();
  Array.from(files).forEach(f => formData.append('files', f));

  // Build progress items
  const progressItems = {};
  Array.from(files).forEach(f => {
    const id = `up-${Math.random().toString(36).slice(2)}`;
    progressItems[f.name] = id;
    progressArea.insertAdjacentHTML('beforeend', `
      <div class="upload-progress-item" id="${id}">
        <span class="text-truncate" style="max-width:200px">${escHtml(f.name)}</span>
        <div class="progress flex-fill"><div class="progress-bar" style="width:0%"></div></div>
        <span class="badge bg-secondary" id="${id}-status">0%</span>
      </div>
    `);
  });

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${MEDIA_API_PREFIX}/upload?path=${encodeURIComponent(state.currentPath)}`);

  xhr.upload.addEventListener('progress', (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.round((e.loaded / e.total) * 100);
    // Update all bars together (single XHR for all files)
    Object.values(progressItems).forEach(id => {
      const bar = document.querySelector(`#${id} .progress-bar`);
      const stat = document.getElementById(`${id}-status`);
      if (bar) bar.style.width = pct + '%';
      if (stat) stat.textContent = pct + '%';
    });
  });

  xhr.addEventListener('load', async () => {
    progressArea.style.display = 'none';
    progressArea.innerHTML = '';

    if (xhr.status !== 200) {
      showWarning('Upload failed (server error). Please try again.', 'danger');
      return;
    }

    let result;
    try { result = JSON.parse(xhr.responseText); } catch { result = {}; }

    if (result.warnings && result.warnings.length > 0) {
      result.warnings.forEach(w => {
        showWarning(`"${w.file}": ${w.reason}`, 'warning');
      });
    }

    if (result.uploaded && result.uploaded.length > 0) {
      const renamed = result.uploaded.filter(u => u.renamed);
      renamed.forEach(u => {
        showWarning(`"${u.original}" was saved as "${u.name}" (name sanitized or collision resolved)`, 'info');
      });
      await loadDirectory();
    }

    if (result.uploaded && result.uploaded.length === 0 && (!result.warnings || result.warnings.length === 0)) {
      showWarning('No files were uploaded.', 'warning');
    }
  });

  xhr.addEventListener('error', () => {
    progressArea.style.display = 'none';
    showWarning('Upload failed (network error).', 'danger');
  });

  xhr.send(formData);
}

/* ══ Copy URL ═══════════════════════════════════════════════════════════════ */
function copyUrl(relPath) {
  const url = `${MEDIA_URL_BASE}/${relPath}`;
  navigator.clipboard.writeText(url).then(() => {
    const toast = new bootstrap.Toast(document.getElementById('copyToast'));
    toast.show();
  }).catch(() => {
    showWarning('Could not copy to clipboard. URL: ' + url, 'info');
  });
}

/* ══ Rename modal ═══════════════════════════════════════════════════════════ */
function openRenameModal(relPath, type) {
  state.renameTarget = { path: relPath, type };
  const name = relPath.split('/').pop();
  document.getElementById('renameInput').value = name;
  document.getElementById('renameWarning').style.display = type === 'folder' ? '' : 'none';
  new bootstrap.Modal(document.getElementById('modalRename')).show();
}

async function confirmRename() {
  const newName = document.getElementById('renameInput').value.trim();
  if (!newName) return;
  const { path: relPath } = state.renameTarget;
  const result = await apiPost('/rename', { path: relPath, newName });
  bootstrap.Modal.getInstance(document.getElementById('modalRename'))?.hide();
  if (result.error) { showWarning(result.error, 'danger'); return; }
  if (result.isFolder) {
    showWarning('Folder renamed. Remember to update any links pointing to its files.', 'info');
  }
  await loadDirectory();
  await loadTree();
}

/* ══ Delete File modal ══════════════════════════════════════════════════════ */
function openDeleteFileModal(relPath, name) {
  state.deleteFileTarget = relPath;
  document.getElementById('deleteFileName').textContent = name;
  new bootstrap.Modal(document.getElementById('modalDeleteFile')).show();
}

async function confirmDeleteFile() {
  const result = await apiPost('/deleteFile', { path: state.deleteFileTarget });
  bootstrap.Modal.getInstance(document.getElementById('modalDeleteFile'))?.hide();
  if (result.error) { showWarning(result.error, 'danger'); return; }
  await loadDirectory();
}

/* ══ Delete Folder modal ════════════════════════════════════════════════════ */
function openDeleteFolderModal(relPath, name) {
  state.deleteFolderTarget = { path: relPath };
  document.getElementById('deleteFolderName').textContent = name;

  // Count entries in folder
  apiGet(`/list?path=${encodeURIComponent(relPath)}`).then(data => {
    const count = (data.entries || []).filter(e => e.type === 'file').length;
    const folderCount = (data.entries || []).filter(e => e.type === 'folder').length;
    const contentDiv = document.getElementById('deleteFolderContents');
    const countEl    = document.getElementById('deleteFolderCount');
    if (count > 0 || folderCount > 0) {
      state.deleteFolderTarget.recursive = true;
      const parts = [];
      if (count > 0) parts.push(`${count} file${count !== 1 ? 's' : ''}`);
      if (folderCount > 0) parts.push(`${folderCount} subfolder${folderCount !== 1 ? 's' : ''}`);
      countEl.textContent = parts.join(' and ');
      contentDiv.style.display = '';
    } else {
      state.deleteFolderTarget.recursive = false;
      contentDiv.style.display = 'none';
    }
  });

  new bootstrap.Modal(document.getElementById('modalDeleteFolder')).show();
}

async function confirmDeleteFolder() {
  const { path: relPath, recursive } = state.deleteFolderTarget;
  const result = await apiPost('/deleteFolder', { path: relPath, recursive });
  bootstrap.Modal.getInstance(document.getElementById('modalDeleteFolder'))?.hide();
  if (result.error) { showWarning(result.error, 'danger'); return; }
  // If we deleted current folder, navigate up
  if (relPath === state.currentPath) {
    const parent = relPath.includes('/') ? relPath.split('/').slice(0, -1).join('/') : '';
    await navigateTo(parent);
  } else {
    await loadDirectory();
    await loadTree();
  }
}

/* ══ Move modal ═════════════════════════════════════════════════════════════ */
async function openMoveModal(relPath, name) {
  state.moveTarget   = relPath;
  state.moveDestPath = null;
  document.getElementById('moveFileName').textContent = name;
  document.getElementById('moveDestLabel').textContent = '—';
  document.getElementById('btnMoveConfirm').disabled = true;

  const treeData = await apiGet('/tree');
  renderMoveTree(treeData);

  new bootstrap.Modal(document.getElementById('modalMove')).show();
}

function renderMoveTree(nodes) {
  const container = document.getElementById('moveFolderTree');
  container.innerHTML = '';

  // Root option
  const rootItem = document.createElement('div');
  rootItem.className = 'move-tree-item';
  rootItem.innerHTML = '<i class="bi bi-folder2-open text-warning me-1"></i> / (root)';
  rootItem.addEventListener('click', () => selectMoveDest('', '/ (root)', rootItem));
  container.appendChild(rootItem);

  nodes.forEach(node => container.appendChild(buildMoveTreeNode(node)));
}

function buildMoveTreeNode(node, depth = 0) {
  const wrap = document.createElement('div');
  const item = document.createElement('div');
  item.className = 'move-tree-item';
  item.style.paddingLeft = (8 + depth * 16) + 'px';
  item.innerHTML = `<i class="bi bi-folder-fill text-warning me-1"></i> ${escHtml(node.name)}`;
  item.addEventListener('click', () => selectMoveDest(node.path, node.name, item));
  wrap.appendChild(item);

  if (node.children && node.children.length > 0) {
    node.children.forEach(child => wrap.appendChild(buildMoveTreeNode(child, depth + 1)));
  }

  return wrap;
}

function selectMoveDest(destPath, label, el) {
  document.querySelectorAll('.move-tree-item').forEach(i => i.classList.remove('selected'));
  el.classList.add('selected');
  state.moveDestPath = destPath;
  document.getElementById('moveDestLabel').textContent = label;
  document.getElementById('btnMoveConfirm').disabled = false;
}

async function confirmMove() {
  if (state.moveDestPath === null) return;
  const result = await apiPost('/move', { srcPath: state.moveTarget, destPath: state.moveDestPath });
  bootstrap.Modal.getInstance(document.getElementById('modalMove'))?.hide();
  if (result.error) { showWarning(result.error, 'danger'); return; }
  if (result.finalName !== state.moveTarget.split('/').pop()) {
    showWarning(`File was renamed to "${result.finalName}" to avoid a name collision at destination.`, 'info');
  }
  await loadDirectory();
}

/* ══ New Folder ═════════════════════════════════════════════════════════════ */
async function confirmNewFolder() {
  const name = document.getElementById('newFolderName').value.trim();
  if (!name) return;
  const result = await apiPost('/createFolder', { path: state.currentPath, name });
  bootstrap.Modal.getInstance(document.getElementById('modalNewFolder'))?.hide();
  document.getElementById('newFolderName').value = '';
  if (result.error) { showWarning(result.error, 'danger'); return; }
  await loadDirectory();
  await loadTree();
}

/* ══ Init & Event Wiring ════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  // Initial load
  await loadTree();
  await loadDirectory();
  renderBreadcrumb();

  // Upload button → file input
  document.getElementById('btnUpload').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', (e) => {
    handleUpload(e.target.files);
    e.target.value = ''; // reset so same files can be re-selected
  });

  // New folder
  document.getElementById('btnNewFolder').addEventListener('click', () => {
    document.getElementById('newFolderName').value = '';
    new bootstrap.Modal(document.getElementById('modalNewFolder')).show();
  });
  document.getElementById('btnNewFolderConfirm').addEventListener('click', confirmNewFolder);
  document.getElementById('newFolderName').addEventListener('keydown', e => { if (e.key === 'Enter') confirmNewFolder(); });

  // Refresh tree
  document.getElementById('btnRefreshTree').addEventListener('click', loadTree);

  // View toggle
  document.getElementById('btnGrid').addEventListener('click', () => {
    state.viewMode = 'grid';
    document.getElementById('btnGrid').classList.add('active');
    document.getElementById('btnList').classList.remove('active');
    renderFiles();
  });
  document.getElementById('btnList').addEventListener('click', () => {
    state.viewMode = 'list';
    document.getElementById('btnList').classList.add('active');
    document.getElementById('btnGrid').classList.remove('active');
    renderFiles();
  });

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.filter;
      state.page = 1;
      renderFiles();
    });
  });

  // Sort
  document.getElementById('sortSelect').addEventListener('change', (e) => {
    state.sort = e.target.value;
    state.page = 1;
    renderFiles();
  });

  // Sort direction toggle
  document.getElementById('btnSortDir').addEventListener('click', () => {
    state.sortAsc = !state.sortAsc;
    document.getElementById('sortDirIcon').className = state.sortAsc ? 'bi bi-sort-down' : 'bi bi-sort-up';
    renderFiles();
  });

  // Modal confirmations
  document.getElementById('btnRenameConfirm').addEventListener('click', confirmRename);
  document.getElementById('renameInput').addEventListener('keydown', e => { if (e.key === 'Enter') confirmRename(); });
  document.getElementById('btnDeleteFileConfirm').addEventListener('click', confirmDeleteFile);
  document.getElementById('btnDeleteFolderConfirm').addEventListener('click', confirmDeleteFolder);
  document.getElementById('btnMoveConfirm').addEventListener('click', confirmMove);
});
