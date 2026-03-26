/**
 * adminSeo — Shared Editor JavaScript
 *
 * Provides common utility functions used by both globalSettings.ejs and pageRules.ejs.
 * Loaded before page-specific scripts.
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HTML ESCAPING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ALERT SYSTEM
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Shows a Bootstrap alert in the #alertArea container.
 * Only one alert is shown at a time.
 *
 * @param {string} message - Alert message (HTML allowed)
 * @param {string} type - Bootstrap alert type (success, warning, danger, info)
 */
function showAlert(message, type) {
  const alertArea = document.getElementById('alertArea');
  if (!alertArea) return;

  // Clear previous alerts
  alertArea.innerHTML = '';

  const alert = document.createElement('div');
  alert.className = `alert alert-${type} alert-dismissible fade show`;
  alert.innerHTML = `${message}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
  alertArea.appendChild(alert);

  // Auto-dismiss timers
  const timeouts = { success: 3000, info: 4000, warning: 5000 };
  const timeout = timeouts[type];
  if (timeout) {
    setTimeout(() => {
      if (alert.parentElement) {
        alert.classList.remove('show');
        setTimeout(() => alert.remove(), 150);
      }
    }, timeout);
  }
}
