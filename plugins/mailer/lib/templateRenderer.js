'use strict';

const fs   = require('fs');
const path = require('path');
const ejs  = require('ejs');

/**
 * TemplateRenderer — Rendering template EJS per email
 *
 * I template si trovano in plugins/mailer/templates/{name}.ejs
 * Le variabili disponibili nel template sono SOLO quelle passate
 * dal chiamante in vars (nessuna variabile iniettata automaticamente).
 *
 * Utilizzo:
 *   const html = await renderer.render('welcome', {
 *     subject:        'Benvenuto!',
 *     username:       'Mario',
 *     activationLink: 'https://...',
 *   });
 */
class TemplateRenderer {
  /**
   * @param {string} pluginFolder - Path root del plugin
   */
  constructor(pluginFolder) {
    this._templatesDir = path.join(pluginFolder, 'templates');
  }

  /**
   * Renderizza un template EJS e restituisce l'HTML
   * @param {string} templateName - Nome del template (senza .ejs)
   * @param {object} vars         - Variabili da iniettare nel template
   * @returns {Promise<string>}   - HTML renderizzato
   * @throws {Error} se il template non esiste
   * @throws {Error} se il rendering EJS fallisce
   */
  async render(templateName, vars) {
    const templatePath = path.join(this._templatesDir, `${templateName}.ejs`);

    if (!fs.existsSync(templatePath)) {
      throw new Error(
        `[mailer/templateRenderer] Template "${templateName}" non trovato. ` +
        `Percorso atteso: ${templatePath}`
      );
    }

    try {
      return await ejs.renderFile(templatePath, vars || {}, { async: true });
    } catch (err) {
      throw new Error(
        `[mailer/templateRenderer] Errore nel rendering del template "${templateName}": ${err.message}`
      );
    }
  }

  /**
   * Restituisce la lista dei template disponibili (senza estensione .ejs)
   * @returns {string[]}
   */
  list() {
    try {
      return fs.readdirSync(this._templatesDir)
        .filter(f => f.endsWith('.ejs'))
        .map(f => path.basename(f, '.ejs'))
        .sort();
    } catch (_) {
      return [];
    }
  }
}

module.exports = TemplateRenderer;
