# Standard EDITABLE

## Sistema di Segnaposto per Template EJS

### ital8cms

**Versione:** 1.0  
**Data:** Dicembre 2024

---

# Parte 1: Definizione dello Standard

## 1. Introduzione

Lo standard EDITABLE definisce un sistema di segnaposto per template EJS che permette di creare pagine statiche personalizzabili mantenendo la possibilità di modifiche future. I tag EDITABLE vengono mantenuti nel file finale per consentire re-editing illimitati.

## 2. Sintassi Base

La sintassi base utilizza commenti EJS per delimitare blocchi editabili:

```ejs
<%# EDITABLE name:identificatore [attributi] %>
contenuto di default o contenuto custom
<%# /EDITABLE %>
```

## 3. Attributi Supportati

Gli attributi definiscono le caratteristiche e il comportamento di ogni blocco editabile:

| Attributo | Valori | Obbligatorio | Descrizione |
|-----------|--------|--------------|-------------|
| **name** | stringa (camelCase) | ✅ Sì | Nome univoco del blocco |
| **type** | text, html, richtext, markdown, image, images, file, files | ✅ Sì | Tipo di contenuto |
| **id** | stringa | ❌ No | ID per sviluppi futuri (DOM, CSS, JS) |
| **label** | stringa | ❌ No | Etichetta visualizzata nell'editor |
| **description** | stringa | ❌ No | Descrizione/help per l'editor |
| **required** | true, false | ❌ No | Campo obbligatorio (default: false) |
| **maxlength** | numero | ❌ No | Lunghezza massima (solo per type:text) |
| **editor** | plain, wysiwyg, markdown, code | ❌ No | Tipo di editor da usare |
| **allowedTags** | stringa | ❌ No | Tag HTML permessi (es: "p,strong,em") |
| **cssClass** | stringa | ❌ No | Classe CSS per il container nell'editor |
| **minCount** | numero | ❌ No | Numero minimo elementi (images, files) |
| **maxCount** | numero | ❌ No | Numero massimo elementi (images, files) |
| **minWidth** | numero (px) | ❌ No | Larghezza minima (image, images) |
| **maxWidth** | numero (px) | ❌ No | Larghezza massima (image, images) |
| **minHeight** | numero (px) | ❌ No | Altezza minima (image, images) |
| **maxHeight** | numero (px) | ❌ No | Altezza massima (image, images) |
| **minSize** | numero (KB) | ❌ No | Dimensione minima file (image, images, file, files) |
| **maxSize** | numero (KB) | ❌ No | Dimensione massima file (image, images, file, files) |
| **allowedExtensions** | stringa | ❌ No | Estensioni permesse (file, files) es: "pdf,doc,docx" |
| **allowedMimeTypes** | stringa | ❌ No | MIME types permessi (image, images, file, files) |

## 4. Formato degli Attributi

Gli attributi seguono il formato **chiave:valore** separati da spazi:

- **Valori senza spazi:** `name:heroSection`
- **Valori con spazi:** `label:"Titolo della pagina"`
- **Booleani:** `required:true` o `required:false`
- **Numeri:** `maxlength:100`

## 5. Tipi di Contenuto

| Tipo | Descrizione | Uso Tipico |
|------|-------------|------------|
| **text** | Testo semplice senza formattazione HTML | Titoli, brevi testi, campi input |
| **html** | HTML completo con struttura | Sezioni complete, layout complessi |
| **richtext** | Testo formattato senza struttura HTML | Paragrafi con formattazione inline |
| **markdown** | Contenuto in formato Markdown | Articoli, documentazione, contenuti strutturati |
| **image** | Immagine singola | Immagini hero, loghi, illustrazione |
| **images** | Galleria di immagini (una o più) | Gallerie fotografiche, slider, portfolio |
| **file** | File singolo | PDF, documento singolo |
| **files** | Uno o più file | Allegati multipli, documentazione |

### 5.1. Tipi Media: Validazione Avanzata

I tipi **image**, **images**, **file** e **files** supportano attributi avanzati per la validazione:

| Attributo | Applicabile a | Esempio | Note |
|-----------|---------------|---------|------|
| **minCount** | images, files | `minCount:3` | Minimo 3 elementi |
| **maxCount** | images, files | `maxCount:10` | Massimo 10 elementi |
| **minWidth** | image, images | `minWidth:800` | Larghezza min 800px |
| **maxWidth** | image, images | `maxWidth:1920` | Larghezza max 1920px |
| **minHeight** | image, images | `minHeight:600` | Altezza min 600px |
| **maxHeight** | image, images | `maxHeight:1080` | Altezza max 1080px |
| **minSize** | image, images, file, files | `minSize:50` | Min 50 KB |
| **maxSize** | image, images, file, files | `maxSize:2048` | Max 2 MB (2048 KB) |
| **allowedExtensions** | file, files | `allowedExtensions:"pdf,doc,docx"` | Solo questi formati |
| **allowedMimeTypes** | image, images, file, files | `allowedMimeTypes:"image/jpeg,image/png"` | MIME types specifici |

## 6. Convenzioni di Naming

**Attributo name:** Deve essere in **camelCase** e univoco all'interno del template. Esempi: `heroSection`, `mainContent`, `sidebarImage`, `pageTitle`.

**Attributo id:** Facoltativo, può seguire convenzioni HTML (kebab-case). Esempi: `main-nav`, `sidebar-img`, `hero-section`.

## 7. Regole di Validazione

- L'attributo **name** è obbligatorio e deve essere univoco
- L'attributo **type** è obbligatorio
- Il **name** deve seguire il formato camelCase: `/^[a-z][a-zA-Z0-9]*$/`
- I blocchi EDITABLE non possono essere annidati
- Se **required:true**, il contenuto non può essere vuoto
- Se specificato **maxlength**, il testo non può superare tale lunghezza
- Se specificato **allowedTags**, solo quei tag HTML sono permessi
- Per **type:images/files**, se specificato **minCount**, il numero di elementi non può essere inferiore
- Per **type:images/files**, se specificato **maxCount**, il numero di elementi non può essere superiore
- Per **type:image/images**, se specificati **minWidth/maxWidth/minHeight/maxHeight**, le dimensioni devono rispettare i vincoli
- Per tutti i tipi media, se specificato **minSize/maxSize**, la dimensione file deve rispettare i vincoli (espressi in KB)
- Se specificato **allowedExtensions**, solo quelle estensioni sono permesse
- Se specificato **allowedMimeTypes**, solo quei MIME types sono permessi

## 8. Workflow di Utilizzo

1. **Step 1:** Creare un template .ejs con blocchi EDITABLE
2. **Step 2:** Caricare il template nel sistema
3. **Step 3:** Il sistema estrae i blocchi EDITABLE e genera un form
4. **Step 4:** L'utente inserisce contenuti custom nei campi del form
5. **Step 5:** Il sistema sostituisce il contenuto tra i tag EDITABLE
6. **Step 6:** Salva il file .ejs finale mantenendo i tag EDITABLE
7. **Step 7:** La pagina può essere ri-editata ripetendo dal punto 2

## 9. Best Practices

- Usa nomi descrittivi in camelCase per gli attributi **name**
- Fornisci sempre contenuto di default significativo
- Usa l'attributo **label** per migliorare l'esperienza utente nell'editor
- Usa **description** per fornire istruzioni chiare
- Specifica **allowedTags** per limitare l'HTML e migliorare la sicurezza
- Riserva l'attributo **id** per integrazioni future con CSS/JS
- Valida sempre i contenuti lato server prima del salvataggio

---

# Parte 2: Esempi Pratici

## Esempio 1: Template Base per Landing Page

Un template semplice con titolo, hero section e contenuto principale:

```ejs
<!DOCTYPE html>
<html>
<head>
  <%# EDITABLE name:pageTitle type:text maxlength:60 
      required:true label:"Titolo della pagina" %>
  <title>Titolo Predefinito</title>
  <%# /EDITABLE %>
</head>
<body>
  <%# EDITABLE name:heroSection type:html 
      editor:wysiwyg label:"Sezione Hero" %>
  <section class="hero">
    <h1>Benvenuto</h1>
    <p>Descrizione hero predefinita</p>
  </section>
  <%# /EDITABLE %>

  <%# EDITABLE name:mainContent type:markdown 
      editor:markdown label:"Contenuto Principale" %>
  ## Chi Siamo
  
  Testo in markdown...
  <%# /EDITABLE %>
</body>
</html>
```

## Esempio 2: Template per Blog Post

Template completo per un articolo di blog con metadata:

```ejs
<%# EDITABLE name:postTitle type:text maxlength:100 
    required:true label:"Titolo del post" %>
<h1>Titolo del post</h1>
<%# /EDITABLE %>

<%# EDITABLE name:postDate type:text 
    label:"Data pubblicazione" 
    description:"Formato: GG/MM/AAAA" %>
<time>01/01/2024</time>
<%# /EDITABLE %>

<%# EDITABLE name:featuredImage type:image 
    description:"Immagine in evidenza (1200x630)" %>
<img src="/images/default.jpg" alt="Featured">
<%# /EDITABLE %>

<%# EDITABLE name:postExcerpt type:richtext 
    maxlength:300 allowedTags:"strong,em" 
    label:"Estratto" %>
<p class="excerpt">Breve descrizione...</p>
<%# /EDITABLE %>

<%# EDITABLE name:postBody type:markdown 
    editor:markdown required:true 
    label:"Corpo dell'articolo" %>
## Introduzione

Contenuto dell'articolo...
<%# /EDITABLE %>
```

## Esempio 3: Pagina Salvata con Contenuto Custom

Esempio di come appare una pagina dopo essere stata editata e salvata:

```ejs
<!DOCTYPE html>
<html>
<head>
  <%# EDITABLE name:pageTitle type:text maxlength:60 
      required:true label:"Titolo della pagina" %>
  <title>La Mia Azienda - Servizi</title>
  <%# /EDITABLE %>
</head>
<body>
  <%# EDITABLE name:heroSection type:html 
      editor:wysiwyg label:"Sezione Hero" %>
  <section class="hero">
    <h1>I Nostri Servizi</h1>
    <p>Offriamo soluzioni innovative per 
       la tua azienda</p>
    <a href="/contatti" class="btn">Contattaci</a>
  </section>
  <%# /EDITABLE %>

  <%# EDITABLE name:mainContent type:markdown 
      editor:markdown label:"Contenuto Principale" %>
  ## Consulenza Strategica
  
  Aiutiamo le aziende a definire strategie 
  vincenti...
  
  ## Sviluppo Software
  
  Creiamo soluzioni custom per ogni esigenza...
  <%# /EDITABLE %>
</body>
</html>
```

> **Nota:** I tag EDITABLE sono mantenuti, permettendo di ri-editare la pagina in qualsiasi momento.

## Esempio 4: Uso dell'attributo ID

L'attributo **id** facoltativo per integrazioni future:

```ejs
<%# EDITABLE name:navigationMenu type:html 
    id:main-nav editor:wysiwyg 
    label:"Menu di navigazione" %>
<nav id="main-nav">
  <ul>
    <li><a href="/">Home</a></li>
    <li><a href="/servizi">Servizi</a></li>
    <li><a href="/contatti">Contatti</a></li>
  </ul>
</nav>
<%# /EDITABLE %>

<script>
// L'id può essere usato per riferimenti CSS/JS
document.getElementById('main-nav')
        .addEventListener('click', ...);
</script>
```

## Esempio 5: Validazione e Sicurezza

Uso di **allowedTags** per limitare l'HTML consentito:

```ejs
<%# EDITABLE name:userBio type:richtext 
    allowedTags:"p,strong,em,a" 
    maxlength:500 
    label:"Biografia utente" 
    description:"Solo testo formattato, no immagini" %>
<p>Biografia predefinita con <strong>grassetto</strong> 
   e <em>corsivo</em>.</p>
<%# /EDITABLE %>
```

In questo esempio, l'utente potrà usare solo i tag p, strong, em e a. Qualsiasi altro tag HTML verrà rifiutato in fase di validazione.

## Esempio 6: Immagini e File

Gestione di contenuti multimediali:

```ejs
<%# EDITABLE name:heroImage type:image 
    description:"Immagine hero (1920x1080 consigliato)" 
    label:"Immagine principale" %>
<img src="/images/default-hero.jpg" 
     alt="Hero image" 
     class="hero-img">
<%# /EDITABLE %>

<%# EDITABLE name:pdfDownload type:file 
    allowedExtensions:"pdf,doc,docx" 
    label:"Documento scaricabile" %>
<a href="/files/brochure.pdf" 
   download>Scarica la brochure</a>
<%# /EDITABLE %>
```

## Esempio 7: Template Complesso Multi-Sezione

Esempio di una pagina completa con multiple sezioni editabili:

```ejs
<!DOCTYPE html>
<html>
<head>
  <%# EDITABLE name:metaTitle type:text 
      maxlength:60 required:true %>
  <title>Titolo SEO</title>
  <%# /EDITABLE %>
  
  <%# EDITABLE name:metaDescription type:text 
      maxlength:160 %>
  <meta name="description" content="Descrizione SEO">
  <%# /EDITABLE %>
</head>
<body>
  <header>
    <%# EDITABLE name:logo type:image 
        id:site-logo %>
    <img src="/logo.png" alt="Logo">
    <%# /EDITABLE %>
    
    <%# EDITABLE name:mainNav type:html 
        id:main-navigation %>
    <nav>...</nav>
    <%# /EDITABLE %>
  </header>

  <main>
    <%# EDITABLE name:hero type:html 
        editor:wysiwyg cssClass:"hero-editor" %>
    <section class="hero">...</section>
    <%# /EDITABLE %>
    
    <%# EDITABLE name:features type:html 
        editor:wysiwyg %>
    <section class="features">...</section>
    <%# /EDITABLE %>
    
    <%# EDITABLE name:testimonials type:html 
        editor:wysiwyg %>
    <section class="testimonials">...</section>
    <%# /EDITABLE %>
  </main>

  <footer>
    <%# EDITABLE name:footerText type:richtext 
        allowedTags:"p,a,strong" %>
    <p>&copy; 2024 - Tutti i diritti riservati</p>
    <%# /EDITABLE %>
  </footer>
</body>
</html>
```

## Esempio 8: Galleria Immagini con Validazione

Uso di **type:images** per gestire multiple immagini con vincoli di dimensione e peso:

```ejs
<%# EDITABLE name:productGallery type:images 
    minCount:3 maxCount:8 
    minWidth:800 maxWidth:2000 
    minHeight:600 maxHeight:1500 
    minSize:100 maxSize:1024 
    allowedMimeTypes:"image/jpeg,image/png,image/webp" 
    label:"Galleria Prodotti" 
    description:"Da 3 a 8 immagini, 800-2000px larghezza, 
                 100KB-1MB ciascuna" %>
<div class="gallery">
  <img src="/images/product-1.jpg" alt="Prodotto 1">
  <img src="/images/product-2.jpg" alt="Prodotto 2">
  <img src="/images/product-3.jpg" alt="Prodotto 3">
</div>
<%# /EDITABLE %>
```

> **Validazione:** Il sistema verificherà che ogni immagine rispetti larghezza (800-2000px), altezza (600-1500px), dimensione file (100KB-1MB) e formato (JPEG, PNG, WebP). Inoltre, devono essere caricate minimo 3 e massimo 8 immagini.

## Esempio 9: Immagine Singola con Vincoli

Validazione su **type:image** singola:

```ejs
<%# EDITABLE name:heroImage type:image 
    minWidth:1920 maxWidth:1920 
    minHeight:1080 maxHeight:1080 
    maxSize:500 
    allowedMimeTypes:"image/jpeg,image/webp" 
    required:true 
    label:"Immagine Hero" 
    description:"Esattamente 1920x1080px, max 500KB, 
                 solo JPEG o WebP" %>
<img src="/images/hero-default.jpg" 
     alt="Hero" 
     width="1920" 
     height="1080">
<%# /EDITABLE %>
```

## Esempio 10: File Multipli con Restrizioni

Uso di **type:files** per allegati multipli:

```ejs
<%# EDITABLE name:documentationFiles type:files 
    minCount:1 maxCount:5 
    maxSize:5120 
    allowedExtensions:"pdf,doc,docx,txt" 
    allowedMimeTypes:"application/pdf,
                      application/msword,
                      application/vnd.openxmlformats-
                      officedocument.wordprocessingml.document,
                      text/plain" 
    label:"Documentazione Allegata" 
    description:"Da 1 a 5 file, max 5MB ciascuno, 
                 formati: PDF, DOC, DOCX, TXT" %>
<div class="attachments">
  <a href="/docs/manuale.pdf">Manuale Utente (PDF)</a>
  <a href="/docs/guida.docx">Guida Rapida (DOCX)</a>
</div>
<%# /EDITABLE %>
```

## Esempio 11: File Singolo con Validazione

Validazione su **type:file** singolo:

```ejs
<%# EDITABLE name:brochurePdf type:file 
    minSize:200 maxSize:3072 
    allowedExtensions:"pdf" 
    allowedMimeTypes:"application/pdf" 
    required:true 
    label:"Brochure Aziendale" 
    description:"Solo PDF, da 200KB a 3MB" %>
<a href="/downloads/brochure.pdf" 
   download 
   class="download-btn">
  Scarica Brochure (PDF)
</a>
<%# /EDITABLE %>
```

---

# Conclusioni

Lo standard EDITABLE fornisce un sistema flessibile e potente per la gestione di template editabili in ital8cms. Le caratteristiche principali sono:

- **Persistenza:** I tag EDITABLE vengono mantenuti per permettere modifiche future
- **Flessibilità:** Supporto per diversi tipi di contenuto (text, html, markdown, image, images, file, files)
- **Validazione:** Sistema di validazione integrato per garantire integrità dei dati
- **Sicurezza:** Controllo granulare sui tag HTML permessi e validazione media avanzata
- **Estendibilità:** Attributo *id* facoltativo per sviluppi futuri
- **Usabilità:** Label e descrizioni per migliorare l'esperienza utente

Questo standard può essere implementato con parser personalizzati e integrato nell'interfaccia di editing del CMS per fornire un'esperienza utente completa e intuitiva.

---

**© 2024 ital8cms - Standard EDITABLE v1.0**
