/**
 * STRUCTURED DATA GENERATOR (JSON-LD)
 *
 * Genera markup JSON-LD per schema.org: Organization e WebSite.
 * Iniettato nel <head> come <script type="application/ld+json">.
 *
 * Schema supportati nella v1:
 * - Organization: dati azienda (nome, logo, contatti, social)
 * - WebSite: informazioni sul sito (nome, URL)
 *
 * Futuri (annotati per sviluppo successivo):
 * - BreadcrumbList
 * - LocalBusiness
 * - Article, Product, FAQ
 *
 * @module plugins/seo/lib/structuredData
 */

/**
 * Genera lo schema Organization in formato JSON-LD.
 *
 * @param {object} config - Configurazione plugin (custom)
 * @returns {object|null} - Oggetto schema Organization, o null se dati insufficienti
 */
function buildOrganizationSchema(config) {
  const org = config.organization || {};
  const name = org.name || config.siteName;
  const url = org.url || config.siteUrl;

  // Dati minimi: serve almeno il nome
  if (!name) return null;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    'name': name,
  };

  if (url) schema.url = url;
  if (org.logo) schema.logo = org.logo;

  // Contatti
  if (org.contactEmail || org.contactPhone) {
    schema.contactPoint = {
      '@type': 'ContactPoint',
    };
    if (org.contactEmail) schema.contactPoint.email = org.contactEmail;
    if (org.contactPhone) {
      schema.contactPoint.telephone = org.contactPhone;
      schema.contactPoint.contactType = 'customer service';
    }
  }

  // Profili social
  if (org.socialProfiles && org.socialProfiles.length > 0) {
    schema.sameAs = org.socialProfiles;
  }

  return schema;
}

/**
 * Genera lo schema WebSite in formato JSON-LD.
 *
 * @param {object} config - Configurazione plugin (custom)
 * @returns {object|null} - Oggetto schema WebSite, o null se dati insufficienti
 */
function buildWebSiteSchema(config) {
  const name = config.siteName;
  const url = config.siteUrl;

  // Dati minimi: serve almeno il nome
  if (!name) return null;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    'name': name,
  };

  if (url) schema.url = url;

  return schema;
}

/**
 * Genera il markup HTML completo per gli structured data.
 * Restituisce uno o più tag <script type="application/ld+json">.
 *
 * @param {object} config - Configurazione plugin (custom)
 * @returns {string} - Markup HTML con script JSON-LD, o stringa vuota
 */
function generateStructuredData(config) {
  if (!config.enableStructuredData) return '';

  const scripts = [];

  const orgSchema = buildOrganizationSchema(config);
  if (orgSchema) {
    scripts.push(`<script type="application/ld+json">${JSON.stringify(orgSchema)}</script>`);
  }

  const siteSchema = buildWebSiteSchema(config);
  if (siteSchema) {
    scripts.push(`<script type="application/ld+json">${JSON.stringify(siteSchema)}</script>`);
  }

  return scripts.join('\n    ');
}

module.exports = {
  buildOrganizationSchema,
  buildWebSiteSchema,
  generateStructuredData,
};
