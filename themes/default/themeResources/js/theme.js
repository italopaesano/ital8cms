/**
 * Theme JavaScript - Default Theme
 *
 * Questo file contiene gli script personalizzati del tema.
 * Viene servito automaticamente da /theme-assets/js/theme.js
 *
 * Per utilizzarlo, aggiungere nel partial footer.ejs:
 * <script src="/theme-assets/js/theme.js"></script>
 */

(function() {
  'use strict';

  // Inizializzazione del tema
  document.addEventListener('DOMContentLoaded', function() {
    console.log('[Theme] Default theme initialized');

    // Inizializza componenti del tema
    initThemeComponents();
  });

  /**
   * Inizializza i componenti del tema
   */
  function initThemeComponents() {
    // Smooth scroll per link interni
    initSmoothScroll();

    // Toggle menu mobile (se presente)
    initMobileMenu();

    // Back to top button (se presente)
    initBackToTop();
  }

  /**
   * Smooth scroll per anchor links
   */
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
      anchor.addEventListener('click', function(e) {
        var targetId = this.getAttribute('href');
        if (targetId === '#') return;

        var target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }
      });
    });
  }

  /**
   * Toggle menu mobile
   */
  function initMobileMenu() {
    var menuToggle = document.querySelector('.theme-menu-toggle');
    var navMenu = document.querySelector('.theme-nav-menu');

    if (menuToggle && navMenu) {
      menuToggle.addEventListener('click', function() {
        navMenu.classList.toggle('active');
        menuToggle.classList.toggle('active');
      });
    }
  }

  /**
   * Back to top button
   */
  function initBackToTop() {
    var backToTop = document.querySelector('.theme-back-to-top');

    if (backToTop) {
      window.addEventListener('scroll', function() {
        if (window.pageYOffset > 300) {
          backToTop.classList.add('visible');
        } else {
          backToTop.classList.remove('visible');
        }
      });

      backToTop.addEventListener('click', function(e) {
        e.preventDefault();
        window.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      });
    }
  }

  // Esporta funzioni utili globalmente (opzionale)
  window.ThemeUtils = {
    initSmoothScroll: initSmoothScroll,
    initMobileMenu: initMobileMenu,
    initBackToTop: initBackToTop
  };

})();
