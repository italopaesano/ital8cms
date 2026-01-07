/**
 * Theme Customization: adminUsers/login
 *
 * JavaScript custom per la pagina di login del plugin adminUsers.
 * Questo file viene auto-iniettato in <head> quando si accede a
 * /pluginPages/adminUsers/login.ejs
 */

console.log('[Theme] adminUsers/login customization loaded');

document.addEventListener('DOMContentLoaded', function() {
  console.log('[Theme] Initializing login page enhancements');

  // Validazione client-side
  const form = document.querySelector('form');
  if (form) {
    form.addEventListener('submit', function(e) {
      const username = form.querySelector('[name="username"]');
      const password = form.querySelector('[name="password"]');

      // Validazione username
      if (username && username.value.length < 3) {
        e.preventDefault();
        showError('Username deve essere almeno 3 caratteri');
        username.focus();
        return false;
      }

      // Validazione password
      if (password && password.value.length < 6) {
        e.preventDefault();
        showError('Password deve essere almeno 6 caratteri');
        password.focus();
        return false;
      }

      // Disabilita pulsante per evitare double-submit
      const submitBtn = form.querySelector('[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Accesso in corso...';
      }
    });

    // Rimuovi messaggi di errore quando l'utente inizia a digitare
    const inputs = form.querySelectorAll('input[type="text"], input[type="password"]');
    inputs.forEach(input => {
      input.addEventListener('input', function() {
        const errorAlert = document.querySelector('.alert-danger');
        if (errorAlert && !errorAlert.dataset.serverError) {
          errorAlert.remove();
        }
      });
    });
  }

  // Aggiungi attributo per distinguere errori server da client
  const serverErrorAlert = document.querySelector('.alert-danger');
  if (serverErrorAlert) {
    serverErrorAlert.dataset.serverError = 'true';
  }

  // Focus automatico sul primo campo vuoto
  const firstEmptyInput = document.querySelector('input[type="text"]:not([value]), input[type="password"]:not([value])');
  if (firstEmptyInput) {
    firstEmptyInput.focus();
  }

  // Password visibility toggle (opzionale)
  addPasswordToggle();
});

/**
 * Mostra messaggio di errore
 */
function showError(message) {
  // Rimuovi errori precedenti
  const existingAlert = document.querySelector('.alert-danger:not([data-server-error])');
  if (existingAlert) {
    existingAlert.remove();
  }

  // Crea nuovo alert
  const alert = document.createElement('div');
  alert.className = 'alert alert-danger';
  alert.textContent = message;

  // Inserisci prima del form
  const form = document.querySelector('form');
  if (form && form.parentNode) {
    form.parentNode.insertBefore(alert, form);
  }
}

/**
 * Aggiunge toggle per mostrare/nascondere password
 */
function addPasswordToggle() {
  const passwordInput = document.querySelector('input[type="password"]');
  if (!passwordInput) return;

  // Crea pulsante toggle
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'btn btn-sm btn-outline-secondary position-absolute end-0 top-50 translate-middle-y me-2';
  toggleBtn.innerHTML = '👁️';
  toggleBtn.title = 'Mostra/Nascondi password';
  toggleBtn.style.cssText = 'z-index: 10; border: none; background: transparent;';

  // Wrapper posizionato
  const wrapper = document.createElement('div');
  wrapper.className = 'position-relative';
  passwordInput.parentNode.insertBefore(wrapper, passwordInput);
  wrapper.appendChild(passwordInput);
  wrapper.appendChild(toggleBtn);

  // Toggle visibility
  toggleBtn.addEventListener('click', function() {
    if (passwordInput.type === 'password') {
      passwordInput.type = 'text';
      toggleBtn.innerHTML = '🙈';
    } else {
      passwordInput.type = 'password';
      toggleBtn.innerHTML = '👁️';
    }
  });
}
