/**
 * ============================================================================
 * defaultAdminTheme - JavaScript per pannello amministrazione
 * ============================================================================
 * Script base per l'interfaccia di amministrazione di ital8cms
 */

(function() {
    'use strict';

    // Inizializzazione tema admin
    console.log('[defaultAdminTheme] Tema amministrazione caricato');

    // Funzioni utility per l'admin
    window.ital8AdminTheme = {
        version: '1.0.0',

        // Log helper per debug
        log: function(message) {
            if (console && console.log) {
                console.log('[Admin Theme]', message);
            }
        },

        // Inizializzazione
        init: function() {
            this.log('Inizializzazione tema admin');
            // Aggiungi qui eventuale logica di inizializzazione
        }
    };

    // Auto-inizializzazione al caricamento DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            window.ital8AdminTheme.init();
        });
    } else {
        window.ital8AdminTheme.init();
    }

})();
