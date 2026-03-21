/**
 * editor.js - Client-side logic for the navbar editor
 *
 * Handles: toolbar snippets, icon preview, validation, preview, save
 *
 * Alert system (Alternative 5):
 *   - One alert visible at a time (new replaces old)
 *   - Timeout by type: success=3s, warning=5s, danger=no timeout (manual dismiss or next alert)
 *
 * Auto-preview:
 *   - On page load (after file content loaded)
 *   - After snippet insertion (item, dropdown, separator, divider)
 *   - After "Replace with empty template"
 *   - After successful save
 *   - Manual button always available
 */

(function () {
  'use strict';

  // apiPrefix, adminPrefix, currentFile are defined as global variables
  // in the <script> block of edit.ejs (injected server-side via EJS)

  const textarea = document.getElementById('editorTextarea');
  const messagesArea = document.getElementById('messagesArea');
  const previewSection = document.getElementById('previewSection');
  const previewContainer = document.getElementById('previewContainer');
  const previewInfo = document.getElementById('previewInfo');
  const fileNameDisplay = document.getElementById('fileNameDisplay');
  const breadcrumbFile = document.getElementById('breadcrumbFile');
  const alertArea = document.getElementById('alertArea');

  // Timer ID for current alert auto-dismiss
  let alertDismissTimer = null;

  // ─── Initialization ──────────────────────────────────────────────────────

  function init() {
    if (!currentFile) {
      showAlert('No file specified', 'danger');
      return;
    }

    fileNameDisplay.textContent = currentFile;
    breadcrumbFile.textContent = currentFile;

    loadFileContent();
    setupToolbar();
    setupIconHelper();
    setupActions();
  }

  // ─── File Loading ────────────────────────────────────────────────────────

  async function loadFileContent() {
    try {
      const response = await fetch(
        `/${apiPrefix}/adminBootstrapNavbar/load?file=${encodeURIComponent(currentFile)}`
      );
      const result = await response.json();

      if (result.success) {
        textarea.value = result.content;
        if (result.parseError) {
          showMessage(`Parse warning: ${result.parseError}`, 'warning');
        }
        // Auto-preview after loading
        showPreview();
      } else {
        showAlert(result.error || 'Error loading file', 'danger');
      }
    } catch (error) {
      showAlert(error.message, 'danger');
    }
  }

  // ─── Toolbar Snippets ────────────────────────────────────────────────────

  const SNIPPETS = {
    item: '      { "label": "New Item", "href": "#" },',
    dropdown: `      {
        "type": "dropdown",
        "label": "Menu",
        "items": [
          { "label": "Item 1", "href": "#" },
          { "type": "divider" },
          { "label": "Item 2", "href": "#" },
        ],
      },`,
    separator: '      { "type": "separator" },',
    divider: '      { "type": "divider" },',
  };

  function setupToolbar() {
    document.getElementById('btnAddItem').addEventListener('click', () => insertSnippet('item'));
    document.getElementById('btnAddDropdown').addEventListener('click', () => insertSnippet('dropdown'));
    document.getElementById('btnAddSeparator').addEventListener('click', () => insertSnippet('separator'));
    document.getElementById('btnAddDivider').addEventListener('click', () => insertSnippet('divider'));
    document.getElementById('btnTemplateEmpty').addEventListener('click', replaceWithEmptyTemplate);
    document.getElementById('btnFromFile').addEventListener('click', openFilePicker);
  }

  /**
   * Inserts a snippet at the end of the selected section (left/right)
   */
  function insertSnippet(snippetType) {
    const content = textarea.value;
    const section = document.getElementById('sectionSelect').value; // 'left' or 'right'
    const snippet = SNIPPETS[snippetType];

    if (!snippet) return;

    // Find the closing bracket of the target section array
    // Strategy: find "left": [ or "right": [ and then find its closing ]
    const sectionPattern = new RegExp(`"${section}"\\s*:\\s*\\[`);
    const match = sectionPattern.exec(content);

    if (!match) {
      showMessage(`Section "${section}" not found in the configuration. Adding to cursor position.`, 'warning');
      // Fallback: insert at cursor
      insertAtCursor(snippet + '\n');
      showPreview();
      return;
    }

    // Find the matching closing bracket
    const startIndex = match.index + match[0].length;
    let bracketCount = 1;
    let insertPos = -1;

    for (let i = startIndex; i < content.length; i++) {
      if (content[i] === '[') bracketCount++;
      if (content[i] === ']') {
        bracketCount--;
        if (bracketCount === 0) {
          insertPos = i;
          break;
        }
      }
    }

    if (insertPos === -1) {
      showMessage('Could not find section closing bracket. Check JSON structure.', 'warning');
      insertAtCursor(snippet + '\n');
      showPreview();
      return;
    }

    // Insert snippet before the closing bracket
    const before = content.substring(0, insertPos);
    const after = content.substring(insertPos);

    // Add newline before snippet if the array is not empty
    const trimmedBefore = before.trimEnd();
    const needsNewline = trimmedBefore.length > 0 && !trimmedBefore.endsWith('[');
    const prefix = needsNewline ? '\n' : '\n';

    textarea.value = before + prefix + snippet + '\n' + after;

    showMessage(`Snippet added to "${section}" section`, 'success');

    // Auto-preview after insertion
    showPreview();
  }

  function insertAtCursor(text) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const content = textarea.value;
    textarea.value = content.substring(0, start) + text + content.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.focus();
  }

  function replaceWithEmptyTemplate() {
    // Extract current navbar name from file name
    const match = currentFile.match(/navbar\.(.+)\.json5$/);
    const navbarName = match ? match[1] : 'newNavbar';

    const emptyTemplate = `// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "settings": {
    "type": "horizontal",
    "colorScheme": "dark",
    "bgClass": "bg-primary",
    "expandAt": "lg",
    "containerClass": "container-fluid",
    "autoActive": true,
    "id": "${navbarName}",
  },

  "sections": {
    "left": [],
    "right": [],
  },
}
`;

    if (confirm('Replace all content with empty template?')) {
      textarea.value = emptyTemplate;
      showMessage('Content replaced with empty template', 'success');
      // Auto-preview after template replacement
      showPreview();
    }
  }

  // ─── File Picker (From File) ─────────────────────────────────────────────

  let filePickerData = null; // Cached browse-files response
  let filePickerSelectedHref = null; // Currently selected href
  let filePickerSelectedRoot = null; // Currently selected root key (e.g., '/www')

  /**
   * Opens the file picker modal and loads the file tree
   */
  async function openFilePicker() {
    // Reset state
    filePickerSelectedHref = null;
    filePickerSelectedRoot = null;
    const summary = document.getElementById('filePickerSummary');
    const confirmBtn = document.getElementById('btnFilePickerConfirm');
    summary.style.display = 'none';
    confirmBtn.disabled = true;

    // Load file tree data
    try {
      const response = await fetch(`/${apiPrefix}/adminBootstrapNavbar/browse-files`);
      filePickerData = await response.json();
    } catch (error) {
      showAlert(`Error loading file tree: ${error.message}`, 'danger');
      return;
    }

    // Show/hide tabs based on developer mode
    const tabsNav = document.getElementById('filePickerTabs');
    if (filePickerData.developerMode) {
      tabsNav.style.display = '';
    } else {
      tabsNav.style.display = 'none';
    }

    // Set default filter from config
    const filterSelect = document.getElementById('filePickerFilter');
    const defaultExt = filePickerData.defaultExt || '.ejs';
    for (const opt of filterSelect.options) {
      opt.selected = (opt.value === defaultExt);
    }

    // Render trees
    renderFileTree('fileTree-www', filePickerData.roots['/www'], '/www');
    if (filePickerData.roots['/pluginPages']) {
      renderFileTree('fileTree-pluginPages', filePickerData.roots['/pluginPages'], '/pluginPages');
    }
    if (filePickerData.roots['/admin']) {
      renderFileTree('fileTree-admin', filePickerData.roots['/admin'], '/admin');
    }

    // Apply initial filter
    applyFileFilter();

    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('filePickerModal'));
    modal.show();
  }

  /**
   * Renders a file tree into a container element
   */
  function renderFileTree(containerId, treeData, rootKey) {
    const container = document.getElementById(containerId);
    if (!container || !treeData) {
      if (container) container.innerHTML = '<p class="text-muted small">No files found</p>';
      return;
    }
    container.innerHTML = '';
    const ul = buildTreeUl(treeData, rootKey, '');
    container.appendChild(ul);
  }

  /**
   * Recursively builds a <ul> tree from file tree data
   */
  function buildTreeUl(node, rootKey, currentPath) {
    const ul = document.createElement('ul');
    ul.className = 'file-tree-list';

    // Directories first
    const dirNames = Object.keys(node.dirs || {}).sort();
    for (const dirName of dirNames) {
      const li = document.createElement('li');
      li.className = 'file-tree-dir';

      const dirPath = currentPath ? `${currentPath}/${dirName}` : dirName;

      const toggle = document.createElement('span');
      toggle.className = 'file-tree-toggle';
      toggle.innerHTML = '<i class="bi bi-chevron-right"></i>';
      toggle.addEventListener('click', () => {
        const isOpen = li.classList.toggle('open');
        toggle.innerHTML = isOpen
          ? '<i class="bi bi-chevron-down"></i>'
          : '<i class="bi bi-chevron-right"></i>';
      });

      const label = document.createElement('span');
      label.className = 'file-tree-dir-label';
      label.innerHTML = `<i class="bi bi-folder"></i> ${escapeHtmlClient(dirName)}`;
      label.addEventListener('click', () => {
        toggle.click();
      });

      li.appendChild(toggle);
      li.appendChild(label);

      // Recursively build children
      const childUl = buildTreeUl(node.dirs[dirName], rootKey, dirPath);
      li.appendChild(childUl);
      ul.appendChild(li);
    }

    // Files
    const files = (node.files || []).sort();
    for (const fileName of files) {
      const li = document.createElement('li');
      li.className = 'file-tree-file';

      const filePath = currentPath ? `${currentPath}/${fileName}` : fileName;

      // Store file extension as data attribute for filtering
      const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
      li.dataset.ext = ext;

      const fileLabel = document.createElement('span');
      fileLabel.className = 'file-tree-file-label';
      fileLabel.innerHTML = `<i class="bi bi-file-earmark"></i> ${escapeHtmlClient(fileName)}`;
      fileLabel.addEventListener('click', () => {
        selectFile(rootKey, filePath, fileName, fileLabel);
      });

      li.appendChild(fileLabel);
      ul.appendChild(li);
    }

    return ul;
  }

  /**
   * Handles file selection in the tree
   */
  function selectFile(rootKey, filePath, fileName, clickedLabel) {
    // Remove previous selection highlight
    document.querySelectorAll('.file-tree-file-label.selected').forEach(el => {
      el.classList.remove('selected');
    });

    // Highlight the clicked label
    if (clickedLabel) {
      clickedLabel.classList.add('selected');
    }

    // Build href based on root
    let href;
    if (rootKey === '/www') {
      href = `/${filePath}`;
    } else if (rootKey === '/pluginPages') {
      href = `/pluginPages/${filePath}`;
    } else if (rootKey === '/admin') {
      href = `/admin/${filePath}`;
    } else {
      href = `/${filePath}`;
    }

    filePickerSelectedHref = href;
    filePickerSelectedRoot = rootKey;

    // Generate label from file name
    const label = generateLabelFromFileName(fileName);

    // Show summary
    const summary = document.getElementById('filePickerSummary');
    document.getElementById('filePickerSelectedPath').textContent = href;
    document.getElementById('filePickerLabel').value = label;
    document.getElementById('filePickerHref').textContent = href;
    summary.style.display = 'block';

    // Enable confirm button
    document.getElementById('btnFilePickerConfirm').disabled = false;
  }

  /**
   * Generates a human-readable label from a file name
   * Examples:
   *   about.ejs → "About"
   *   hello_word.ejs → "Hello Word"
   *   userProfile.ejs → "User Profile"
   *   contact-us.ejs → "Contact Us"
   */
  function generateLabelFromFileName(fileName) {
    // Remove extension
    let name = fileName.replace(/\.[^.]+$/, '');

    // Split on underscores, hyphens, and camelCase boundaries
    name = name
      .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase → camel Case
      .replace(/[_-]/g, ' '); // underscore/hyphen → space

    // Capitalize first letter of each word
    return name
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Applies the file extension filter to all tree views
   */
  function applyFileFilter() {
    const filterValue = document.getElementById('filePickerFilter').value;

    document.querySelectorAll('.file-tree-file').forEach(li => {
      if (filterValue === '*') {
        li.style.display = '';
      } else {
        li.style.display = (li.dataset.ext === filterValue) ? '' : 'none';
      }
    });

    // Hide empty directories (all children hidden)
    document.querySelectorAll('.file-tree-dir').forEach(dirLi => {
      const visibleChildren = dirLi.querySelectorAll('.file-tree-file:not([style*="display: none"])');
      const childDirs = dirLi.querySelectorAll(':scope > .file-tree-list > .file-tree-dir:not([style*="display: none"])');
      if (visibleChildren.length === 0 && childDirs.length === 0) {
        dirLi.style.display = 'none';
      } else {
        dirLi.style.display = '';
      }
    });
  }

  /**
   * Confirms the file picker selection and inserts the snippet
   */
  function confirmFilePicker() {
    if (!filePickerSelectedHref) return;

    const label = document.getElementById('filePickerLabel').value.trim() || 'New Item';
    const href = filePickerSelectedHref;

    const snippet = `      { "label": "${label}", "href": "${href}" },`;
    insertSnippet_raw(snippet);

    // Close modal
    const modalEl = document.getElementById('filePickerModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();

    showMessage(`Item "${label}" added from file`, 'success');
    showPreview();
  }

  /**
   * Inserts a raw snippet string into the selected section (reuses insertSnippet logic)
   */
  function insertSnippet_raw(snippet) {
    const content = textarea.value;
    const section = document.getElementById('sectionSelect').value;

    const sectionPattern = new RegExp(`"${section}"\\s*:\\s*\\[`);
    const match = sectionPattern.exec(content);

    if (!match) {
      insertAtCursor(snippet + '\n');
      return;
    }

    const startIndex = match.index + match[0].length;
    let bracketCount = 1;
    let insertPos = -1;

    for (let i = startIndex; i < content.length; i++) {
      if (content[i] === '[') bracketCount++;
      if (content[i] === ']') {
        bracketCount--;
        if (bracketCount === 0) {
          insertPos = i;
          break;
        }
      }
    }

    if (insertPos === -1) {
      insertAtCursor(snippet + '\n');
      return;
    }

    const before = content.substring(0, insertPos);
    const after = content.substring(insertPos);
    textarea.value = before + '\n' + snippet + '\n' + after;
  }

  /**
   * Simple HTML escape for client-side rendering
   */
  function escapeHtmlClient(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Icon Helper ─────────────────────────────────────────────────────────

  function setupIconHelper() {
    const iconInput = document.getElementById('iconInput');
    const iconPreview = document.getElementById('iconPreview');

    iconInput.addEventListener('input', () => {
      const html = iconInput.value.trim();
      if (html) {
        iconPreview.innerHTML = html;
      } else {
        iconPreview.innerHTML = '';
      }
    });
  }

  // ─── Actions (Validate, Preview, Save) ───────────────────────────────────

  function setupActions() {
    document.getElementById('btnValidate').addEventListener('click', validateContent);
    document.getElementById('btnPreview').addEventListener('click', showPreview);
    document.getElementById('btnSave').addEventListener('click', saveContent);
    document.getElementById('btnClosePreview').addEventListener('click', () => {
      previewSection.style.display = 'none';
    });

    // File picker actions
    document.getElementById('filePickerFilter').addEventListener('change', applyFileFilter);
    document.getElementById('btnFilePickerConfirm').addEventListener('click', confirmFilePicker);
  }

  async function validateContent() {
    clearMessages();

    const content = textarea.value;
    if (!content.trim()) {
      showMessage('Content is empty', 'error');
      return;
    }

    try {
      const response = await fetch(`/${apiPrefix}/adminBootstrapNavbar/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const result = await response.json();

      if (result.valid) {
        showMessage('JSON5 is valid! No errors found.', 'success');
      } else {
        result.errors.forEach(err => showMessage(err, 'error'));
      }

      if (result.warnings && result.warnings.length > 0) {
        result.warnings.forEach(w => showMessage(w, 'warning'));
      }
    } catch (error) {
      showMessage(`Validation error: ${error.message}`, 'error');
    }
  }

  async function showPreview() {
    const content = textarea.value;
    if (!content.trim()) return;

    try {
      const response = await fetch(`/${apiPrefix}/adminBootstrapNavbar/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const result = await response.json();

      if (result.success) {
        previewContainer.innerHTML = result.html;

        // Show settings info
        const s = result.settings;
        previewInfo.textContent = `Type: ${s.type} | Color: ${s.colorScheme} | Bg: ${s.bgClass} | ` +
          `Items: ${s.itemsLeft} left, ${s.itemsRight} right | Breakpoint: ${s.expandAt}`;

        previewSection.style.display = 'block';
      } else {
        showMessage(`Preview error: ${result.error}`, 'error');
      }
    } catch (error) {
      showMessage(`Preview error: ${error.message}`, 'error');
    }
  }

  async function saveContent() {
    clearMessages();

    const content = textarea.value;
    if (!content.trim()) {
      showMessage('Content is empty', 'error');
      return;
    }

    // Validate before saving
    try {
      const valResponse = await fetch(`/${apiPrefix}/adminBootstrapNavbar/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const valResult = await valResponse.json();

      if (!valResult.valid) {
        valResult.errors.forEach(err => showMessage(err, 'error'));
        showAlert('Cannot save: validation errors found', 'danger');
        return;
      }

      if (valResult.warnings && valResult.warnings.length > 0) {
        valResult.warnings.forEach(w => showMessage(w, 'warning'));
      }
    } catch (error) {
      showMessage(`Validation error: ${error.message}`, 'error');
      return;
    }

    // Save
    try {
      const response = await fetch(`/${apiPrefix}/adminBootstrapNavbar/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: currentFile, content }),
      });
      const result = await response.json();

      if (result.success) {
        showAlert('Navbar saved successfully!', 'success');
        // Auto-preview after successful save
        showPreview();
      } else {
        showAlert(`Save error: ${result.error}`, 'danger');
      }
    } catch (error) {
      showAlert(`Save error: ${error.message}`, 'danger');
    }
  }

  // ─── Message Helpers ─────────────────────────────────────────────────────

  function showMessage(text, type) {
    const div = document.createElement('div');
    div.className = `message-item message-${type}`;
    div.textContent = text;
    messagesArea.appendChild(div);
  }

  function clearMessages() {
    messagesArea.innerHTML = '';
  }

  /**
   * Shows a single alert, replacing any previous one.
   * Timeout by type: success=3s, warning=5s, danger=no auto-dismiss.
   */
  function showAlert(message, type) {
    // Clear any existing dismiss timer
    if (alertDismissTimer) {
      clearTimeout(alertDismissTimer);
      alertDismissTimer = null;
    }

    // Remove previous alert (single alert at a time)
    alertArea.innerHTML = '';

    // Create new alert
    const alertEl = document.createElement('div');
    alertEl.className = `alert alert-${type} alert-dismissible fade show`;
    alertEl.innerHTML = `${message}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
    alertArea.appendChild(alertEl);

    // Auto-dismiss timeout based on type
    const timeouts = { success: 3000, warning: 5000 };
    const timeout = timeouts[type];

    if (timeout) {
      alertDismissTimer = setTimeout(() => {
        // Fade out then remove
        alertEl.classList.remove('show');
        setTimeout(() => {
          if (alertEl.parentNode) {
            alertEl.remove();
          }
        }, 300); // Bootstrap fade transition duration
        alertDismissTimer = null;
      }, timeout);
    }
    // danger: no timeout — stays until manually dismissed or replaced by next alert
  }

  // ─── Start ───────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', init);
})();
