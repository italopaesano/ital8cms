# Plugin SEO — Documentazione

## Panoramica

Il plugin `seo` gestisce l'ottimizzazione per i motori di ricerca di ital8cms. Opera in due modalità distinte:

- **Runtime** — inietta meta tags nel `<head>` di ogni pagina tramite il sistema di hook
- **Boot** — genera i file fisici `sitemap.xml` e `robots.txt` nella directory `wwwPath`

Ogni funzionalità è disattivabile individualmente. Il plugin non ha dipendenze da altri plugin.

**Weight:** `5` (si carica dopo `simpleI18n` a −10, prima di `bootstrapNavbar` a 10)

---

## Struttura file

```
plugins/seo/
├── main.js                  ← Entry point del plugin
├── pluginConfig.json5       ← Configurazione globale + feature toggles
├── pluginDescription.json5  ← Metadati plugin (nome, versione, autore)
├── seoPages.json5           ← Regole SEO per singola pagina o gruppo di pagine
└── lib/
    ├── metaTagGenerator.js  ← Genera meta tags, Open Graph, Twitter Cards, canonical URL
    ├── structuredData.js    ← Genera dati strutturati JSON-LD (Organization, WebSite)
    ├── sitemapGenerator.js  ← Genera sitemap.xml (auto-scan + pagine extra)
    └── robotsTxtGenerator.js← Genera robots.txt
```

---

## Flusso di avvio

Al caricamento del plugin (`loadPlugin`):

1. Legge `pluginConfig.json5` → estrae il blocco `custom` come configurazione attiva
2. Legge `seoPages.json5` → carica le regole per pagina in memoria
3. Legge `ital8Config.json5` → ottiene `wwwPath`, `indexFiles`, `debugMode`
4. Esegue validazione al boot di `seoPages.json5` (warning in console, non blocca il server)
5. Genera `sitemap.xml` e `robots.txt` come file fisici in `wwwPath`

---

## Feature toggles

Ogni funzionalità si attiva o disattiva indipendentemente in `pluginConfig.json5 → custom`:

| Chiave | Default | Cosa controlla |
|---|---|---|
| `enableMetaTags` | `true` | `<meta name="description">`, `<meta name="keywords">`, `<meta name="robots">` |
| `enableOpenGraph` | `true` | Tutti i tag `<meta property="og:*">` |
| `enableTwitterCards` | `true` | Tutti i tag `<meta name="twitter:*">` |
| `enableCanonicalUrl` | `true` | `<link rel="canonical">` |
| `enableStructuredData` | `true` | `<script type="application/ld+json">` (Organization + WebSite) |
| `enableSitemap` | `true` | Generazione di `wwwPath/sitemap.xml` |
| `enableRobotsTxt` | `true` | Generazione di `wwwPath/robots.txt` |

---

## Configurazione globale — pluginConfig.json5

Il blocco `custom` contiene tutte le impostazioni del plugin, divise in sezioni:

### Site identity
```json5
"siteName": "",   // Nome del sito, usato in OG e structured data
"siteUrl": "",    // URL base (es. "https://www.example.com") — usato per canonical, sitemap, robots.txt
```

### Canonical URL
```json5
"canonicalCleanUrl": true  // true = rimuove .ejs dall'URL canonical (/about.ejs → /about)
                           // Attivare quando hideExtension è attivo in ital8Config.json5
```

### Valori di default
Usati per le pagine che non hanno una regola in `seoPages.json5`:
```json5
"defaultDescription": "",
"defaultKeywords": "",
"defaultRobots": "index, follow",
"defaultOgType": "website",
"defaultOgImage": "",                       // Path relativo (es. "/media/og-default.jpg")
"twitterCardType": "summary_large_image",   // "summary" | "summary_large_image"
"twitterHandle": ""                         // Es. "@aziendaxyz"
```

### Structured data (JSON-LD)
```json5
"organization": {
  "name": "",              // Se vuoto, usa siteName
  "url": "",               // Se vuoto, usa siteUrl
  "logo": "",              // URL assoluto al logo
  "contactEmail": "",
  "contactPhone": "",
  "socialProfiles": []     // Es. ["https://facebook.com/azienda", "https://x.com/azienda"]
}
```
Se `organization.name` è vuoto e `siteName` è vuoto, il blocco Organization non viene generato.
Il blocco WebSite richiede solo `siteName`.

### Sitemap
```json5
"sitemapAutoScan": true,              // Scansiona wwwPath alla ricerca di file .ejs
"sitemapDefaultChangefreq": "monthly",
"sitemapDefaultPriority": 0.5,        // Da 0.0 a 1.0
"sitemapExclude": [                   // Pattern di esclusione (relativi a wwwPath)
  "**/*test*",
  "**/navbarExamples/**"
],
"sitemapExtraPages": []               // Pagine non raggiungibili dall'auto-scan
                                      // Es. [{ "url": "/custom", "changefreq": "weekly", "priority": 0.8 }]
```

### robots.txt
```json5
"robotsTxtRules": {
  "userAgent": "*",
  "allow": ["/"],
  "disallow": ["/admin/", "/api/", "/pluginPages/"]
}
```
Il link alla sitemap (`Sitemap: https://...`) viene aggiunto automaticamente se sia `enableSitemap` che `siteUrl` sono configurati.

---

## Regole per pagina — seoPages.json5

Ogni chiave dell'oggetto radice è un **pattern URL** a cui si applicano le regole SEO. Supporta gli stessi pattern di `adminAccessControl` (condividono `/core/patternMatcher.js`).

### Tipi di pattern

| Pattern | Tipo | Priorità | Esempio di match |
|---|---|---|---|
| `/about.ejs` | Esatto | 1000 | Solo `/about.ejs` |
| `regex:^/product/\d+$` | Regex | 500 | `/product/42` |
| `/blog/*.ejs` | Wildcard singolo | 300 | `/blog/post.ejs` (non `/blog/a/b.ejs`) |
| `/docs/**` | Wildcard ricorsivo | 100 | `/docs/a`, `/docs/a/b/c` |

Quando più pattern matchano lo stesso URL, vince quello con priorità più alta (numero più grande).

### Campi supportati per regola

| Campo | Tipo | Usato da |
|---|---|---|
| `title` | `string` \| `{ lang: string }` | OG (`og:title`), Twitter (`twitter:title`) |
| `description` | `string` \| `{ lang: string }` | `<meta name="description">`, OG, Twitter |
| `keywords` | `string` \| `{ lang: string }` | `<meta name="keywords">` |
| `robots` | `string` | `<meta name="robots">` |
| `ogType` | `string` | `<meta property="og:type">` |
| `ogImage` | `string` | OG e Twitter (path relativo o URL assoluto) |
| `twitterCardType` | `string` | `<meta name="twitter:card">` |
| `sitemap` | `object` \| `false` | Configurazione sitemap per questa pagina |
| `sitemap.priority` | `number` (0.0–1.0) | Priorità nella sitemap |
| `sitemap.changefreq` | `string` | Frequenza aggiornamento nella sitemap |
| `sitemap: false` | — | Esclude la pagina dalla sitemap |

### Esempio

```json5
{
  "/": {
    "title": { "it": "Azienda XYZ - Soluzioni", "en": "XYZ Corp - Solutions" },
    "description": { "it": "Leader dal 1990", "en": "Leader since 1990" },
    "ogImage": "/media/og-home.jpg",
    "sitemap": { "priority": 1.0, "changefreq": "daily" }
  },

  "/about.ejs": {
    "title": "Chi Siamo",
    "sitemap": { "priority": 0.8, "changefreq": "monthly" }
  },

  "/blog/*.ejs": {
    "ogType": "article",
    "robots": "index, follow"
  },

  "/private/**": {
    "robots": "noindex, nofollow",
    "sitemap": false
  }
}
```

---

## Supporto multilingua — Strada B3

Il plugin è **completamente indipendente** da `simpleI18n`. I campi testuali supportano due formati:

**Formato 1 — Stringa semplice (sito monolingua):**
```json5
"title": "Azienda XYZ - Soluzioni innovative"
```

**Formato 2 — Oggetto multilingua:**
```json5
"title": { "it": "Azienda XYZ - Soluzioni", "en": "XYZ Corp - Solutions" }
```

**Cascata di risoluzione per oggetti multilingua:**
1. Se `ctx.state.lang` esiste (impostato da `simpleI18n` se attivo) → usa quella lingua
2. Altrimenti → usa la prima lingua disponibile nell'oggetto

**Percorso di crescita:**
- Sito monolingua, nessun i18n → usa stringhe semplici. Funziona.
- Preparazione al multilingua → converti in `{ "it": "..." }`. Funziona (prima lingua come fallback).
- Attivazione di `simpleI18n` → aggiungi `"en": "..."`. Funziona automaticamente.

---

## Hook system — iniezione nel `<head>`

Il plugin implementa `getHooksPage()` che restituisce una `Map` con la chiave `'head'`.

Ad ogni richiesta, il hook viene chiamato con `passData` e:

1. **Contesto admin** (`passData.isAdminContext === true`) — inietta solo:
   ```html
   <meta name="robots" content="noindex, nofollow">
   ```
   (solo se `enableMetaTags` è attivo)

2. **Contesto pubblico** — esegue la sequenza completa:
   - Cerca la regola matchante in `seoPages.json5` tramite `PatternMatcher`
   - Genera meta tags, canonical, OG, Twitter via `metaTagGenerator.js`
   - Genera JSON-LD via `structuredData.js`
   - Restituisce tutto come stringa HTML

**Debug mode** (`ital8Config.json5 → debugMode >= 1`): ad ogni richiesta rilegge `seoPages.json5` da disco, consentendo modifiche istantanee senza riavviare il server.

---

## File generati

Entrambi i file vengono scritti con **scrittura atomica** (file `.tmp` + `rename`) e solo se il contenuto è cambiato rispetto all'esistente (**diff prima di sovrascrivere**).

### sitemap.xml

Generata in `{wwwPath}/sitemap.xml`. Il processo di generazione:

1. **Auto-scan** — scansiona ricorsivamente `wwwPath` per file `.ejs`
2. **Esclusione** — applica i pattern in `sitemapExclude`
3. **Override da seoPages** — legge `sitemap.priority` e `sitemap.changefreq` per ogni pagina
4. **Esclusione esplicita** — se una regola ha `sitemap: false`, la pagina è esclusa
5. **Index files** — `index.ejs` viene mappato alla directory (`/navbarExamples/index.ejs` → `/navbarExamples/`)
6. **Clean URL** — rimuove `.ejs` se `canonicalCleanUrl: true`
7. **Pagine extra** — aggiunge le voci di `sitemapExtraPages`

### robots.txt

Generato in `{wwwPath}/robots.txt`. Struttura:
```
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /api/
Disallow: /pluginPages/

Sitemap: https://www.example.com/sitemap.xml  ← aggiunto automaticamente se siteUrl è configurato
```

---

## Librerie interne

### lib/metaTagGenerator.js

| Funzione | Descrizione |
|---|---|
| `resolveValue(value, ctx)` | Risolve un valore stringa o multilingua nel testo corretto per il contesto |
| `escapeAttr(str)` | Escapa caratteri HTML per attributi (`&`, `"`, `<`, `>`) |
| `buildCanonicalUrl(passData, config)` | Costruisce l'URL canonical dalla richiesta corrente |
| `generateMetaTags(pageRule, passData, config)` | Genera l'intero blocco HTML di meta tags (meta base, canonical, OG, Twitter) |

### lib/structuredData.js

| Funzione | Descrizione |
|---|---|
| `buildOrganizationSchema(config)` | Costruisce l'oggetto JSON-LD per schema.org/Organization |
| `buildWebSiteSchema(config)` | Costruisce l'oggetto JSON-LD per schema.org/WebSite |
| `generateStructuredData(config)` | Genera i tag `<script type="application/ld+json">` pronti per l'HTML |

Richiede almeno `siteName` per generare qualcosa. Se tutti i campi sono vuoti, restituisce stringa vuota.

### lib/sitemapGenerator.js

| Funzione | Descrizione |
|---|---|
| `scanDirectory(dirPath, basePath)` | Scansione ricorsiva di una directory per file `.ejs` |
| `isIndexFile(relativePath, indexFiles)` | Verifica se un file è un file indice |
| `pathToUrl(relativePath, indexFiles, cleanUrl)` | Converte path filesystem in URL per la sitemap |
| `isExcluded(relativePath, excludePatterns)` | Verifica se un path è escluso tramite pattern |
| `generateSitemapXml(options)` | Genera il contenuto XML completo della sitemap |
| `writeSitemapIfChanged(outputPath, xmlContent)` | Scrive su disco solo se il contenuto è cambiato |
| `escapeXml(str)` | Escapa caratteri speciali XML |

### lib/robotsTxtGenerator.js

| Funzione | Descrizione |
|---|---|
| `generateRobotsTxt(config)` | Genera il contenuto testuale del file robots.txt |
| `writeRobotsTxtIfChanged(outputPath, content)` | Scrive su disco solo se il contenuto è cambiato |

---

## API endpoint

```
POST /api/seo/regenerate
```

Rigenera `sitemap.xml` e `robots.txt` on-demand, rileggendo prima la configurazione aggiornata.

**Accesso:** `requiresAuth: true`, `allowedRoles: [0, 1]` (solo root e admin)

**Risposta:**
```json
{
  "sitemap": { "changed": true, "pages": 12 },
  "robotsTxt": { "changed": false }
}
```

---

## Oggetti condivisi con altri plugin

Il plugin implementa `getObjectToShareToOthersPlugin()` e `getObjectToShareToWebPages()`.

### Con altri plugin (es. adminSeo)

Accessibile via `pluginSys.getSharedObject('seo', 'adminSeo')`:

| Metodo | Descrizione |
|---|---|
| `getConfig()` | Copia del blocco `custom` di `pluginConfig.json5` |
| `getSeoPages()` | Copia delle regole da `seoPages.json5` |
| `regenerate()` | Avvia la rigenerazione dei file fisici |
| `findPageRule(urlPath)` | Trova la regola matchante per un URL dato |

### Con i template EJS (passData.plugin.seo)

```ejs
<% const seoConfig = passData.plugin.seo.getConfig() %>
```

---

## Interazione con adminSeo

Il plugin `adminSeo` (separato) fornisce l'interfaccia admin per gestire questo plugin. Le due interfacce admin agiscono sui seguenti file:

| Interfaccia | File modificato |
|---|---|
| `/admin/seoManagement/globalSettings.ejs` | `plugins/seo/pluginConfig.json5` (solo blocco `custom`) |
| `/admin/seoManagement/pageRules.ejs` | `plugins/seo/seoPages.json5` |

`adminSeo` legge i dati tramite le route API `/api/adminSeo/load-settings` e `/api/adminSeo/load-page-rules`, e salva con backup automatico in `plugins/adminSeo/backups/`.

---

## Dipendenze

### Plugin
Nessuna. Zero dipendenze da altri plugin.

### Utility core condivise
- `/core/loadJson5.js` — lettura file di configurazione
- `/core/patternMatcher.js` — pattern matching per URL (condiviso con `adminAccessControl`)

### Node.js built-in
- `fs` — lettura/scrittura file generati
- `path` — manipolazione path

---

## Limitazioni note e sviluppi futuri

- **Auto-scan solo wwwPath** — le pagine in `pluginPages/` e quelle servite da plugin via route non vengono rilevate automaticamente; vanno aggiunte manualmente in `sitemapExtraPages`
- **Structured data di pagina** — nella v1 solo Organization e WebSite globali; non sono supportati Article, Product, BreadcrumbList per singola pagina
- **hreflang** — non supportato nella v1; utile per siti con contenuto identico in più lingue su URL diversi
- **X-Robots-Tag** — solo `<meta name="robots">`, non header HTTP; rilevante per contenuti non-HTML
- **adminSeo** — il plugin di gestione admin esiste come plugin separato (`plugins/adminSeo/`)
