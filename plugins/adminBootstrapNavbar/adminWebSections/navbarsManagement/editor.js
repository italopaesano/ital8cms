/**
 * editor.js - Client-side logic for the navbar editor
 *
 * Handles: toolbar snippets, icon preview, validation, preview, save
 */

(function () {
  'use strict';

  const apiPrefix = document.getElementById('apiPrefix').innerText;
  const adminPrefix = document.getElementById('adminPrefix').innerText;
  const currentFile = document.getElementById('currentFile').innerText;

  const textarea = document.getElementById('editorTextarea');
  const messagesArea = document.getElementById('messagesArea');
  const previewSection = document.getElementById('previewSection');
  const previewContainer = document.getElementById('previewContainer');
  const previewInfo = document.getElementById('previewInfo');
  const fileNameDisplay = document.getElementById('fileNameDisplay');
  const breadcrumbFile = document.getElementById('breadcrumbFile');
  const alertArea = document.getElementById('alertArea');

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
    }
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
    if (!content.trim()) {
      showMessage('Content is empty', 'error');
      return;
    }

    try {
      const response = await fetch(`/${apiPrefix}/adminBootstrapNavbar/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const result = await response.json();

      if (result.success) {
        // Load Bootstrap CSS into the preview
        previewContainer.innerHTML = result.html;

        // Show settings info
        const s = result.settings;
        previewInfo.textContent = `Type: ${s.type} | Color: ${s.colorScheme} | Bg: ${s.bgClass} | ` +
          `Items: ${s.itemsLeft} left, ${s.itemsRight} right | Breakpoint: ${s.expandAt}`;

        previewSection.style.display = 'block';

        // Scroll to preview
        previewSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  function showAlert(message, type) {
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} alert-dismissible fade show`;
    alert.innerHTML = `${message}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
    alertArea.prepend(alert);
  }

  // ─── Start ───────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', init);
})();
