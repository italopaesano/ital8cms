/*
================================================================================
THEME.JS - JavaScript personalizzato del tema exampleTheme
================================================================================
Questo file contiene gli script specifici del tema.
È caricato da footer.ejs tramite: /theme-assets/js/theme.js

NOTA: Bootstrap JS viene caricato tramite l'hook "script" dal plugin bootstrap,
quindi qui puoi usare le funzionalità Bootstrap (tooltip, modal, etc.)
================================================================================
*/

// Attendi che il DOM sia pronto
document.addEventListener('DOMContentLoaded', function() {

    // =========================================================================
    // ESEMPIO: Inizializzazione componenti Bootstrap
    // =========================================================================

    // Inizializza tutti i tooltip
    var tooltipTriggerList = [].slice.call(
        document.querySelectorAll('[data-bs-toggle="tooltip"]')
    );
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });

    // Inizializza tutti i popover
    var popoverTriggerList = [].slice.call(
        document.querySelectorAll('[data-bs-toggle="popover"]')
    );
    popoverTriggerList.map(function (popoverTriggerEl) {
        return new bootstrap.Popover(popoverTriggerEl);
    });

    // =========================================================================
    // ESEMPIO: Log di debug
    // =========================================================================
    console.log('[exampleTheme] Theme JavaScript loaded successfully');

});

// =========================================================================
// FUNZIONI UTILITY DEL TEMA
// =========================================================================

/**
 * Mostra un toast di notifica
 * @param {string} message - Messaggio da mostrare
 * @param {string} type - Tipo: 'success', 'error', 'warning', 'info'
 */
function showToast(message, type = 'info') {
    // Implementa la logica del toast qui
    console.log(`[${type.toUpperCase()}] ${message}`);
}

/**
 * Toggle dark mode
 */
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
}
