# 🎨 Demo: Personalizzazione Login/Logout tramite Tema

## 📋 Panoramica

Questa directory dimostra come il **tema attivo** (`placeholderExample`) può **iniettare CSS personalizzato** nelle pagine del plugin `adminUsers` (login e logout).

## 📁 Struttura

```
themes/placeholderExample/pluginsEndpointsMarkup/adminUsers/
├── README.md                    ← Questo file
├── login/
│   └── style.css               ← CSS personalizzato per /api/adminUsers/login
└── logout/
    └── style.css               ← CSS personalizzato per /api/adminUsers/logout
```

## 🔄 Come Funziona

### **1. Backend (main.js) - Carica CSS dal tema**

Quando un utente visita `/api/adminUsers/login`:

```javascript
// plugins/adminUsers/main.js (linea 125)
customCss = themeSys.getPluginCustomCss('adminUsers', 'login');
//          ↓
//          Cerca il file: themes/{activeTheme}/pluginsEndpointsMarkup/adminUsers/login/style.css
//          Se esiste → Legge il contenuto
//          Se NON esiste → Restituisce stringa vuota
```

### **2. Backend - Passa a EJS**

```javascript
// plugins/adminUsers/main.js (linea 130-132)
ejsData.customCss = customCss;  // Aggiunge CSS all'oggetto dati

ctx.body = await ejs.renderFile(loginPage, ejsData);
//                                          ↑
//                                     customCss è disponibile nel template
```

### **3. Template (login.ejs) - Inietta CSS**

```ejs
<!-- plugins/adminUsers/webPages/login.ejs (linee 8-13) -->
<% if (customCss) { %>
  <style>
    <%- customCss %>
  </style>
<% } %>
```

Se `customCss` non è vuoto, il contenuto di `style.css` viene inserito inline nell'HTML.

## 🎯 Risultato Finale

**Senza tema personalizzato:**
```html
<head>
  <link rel="stylesheet" href="/api/bootstrap/css/bootstrap.min.css">
  <!-- Nessun CSS personalizzato -->
</head>
```

**Con tema personalizzato (placeholderExample attivo):**
```html
<head>
  <link rel="stylesheet" href="/api/bootstrap/css/bootstrap.min.css">

  <!-- CSS personalizzato iniettato -->
  <style>
    body {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    /* ... resto del CSS da style.css ... */
  </style>
</head>
```

## 🧪 Come Testare

### **Passo 1: Verifica tema attivo**

Controlla che `placeholderExample` sia il tema attivo in `ital8Config.json5`:

```json5
{
  "activeTheme": "placeholderExample"
}
```

### **Passo 2: Visita le pagine**

1. **Login personalizzato:**
   - URL: `http://localhost:3000/api/adminUsers/login`
   - Dovresti vedere:
     - ✅ Sfondo sfumato **viola-blu**
     - ✅ Card con effetto glassmorphism
     - ✅ Badge "🎨 Tema Personalizzato Attivo" in alto a destra
     - ✅ Animazioni fluide
     - ✅ Icona 🔐 nel titolo

2. **Logout personalizzato:**
   - URL: `http://localhost:3000/api/adminUsers/logout`
   - Dovresti vedere:
     - ✅ Sfondo sfumato **rosso-arancione**
     - ✅ Badge "🎨 Tema Logout Personalizzato"
     - ✅ Icona 👋 nel titolo
     - ✅ Stile diverso da login

### **Passo 3: Disabilita per confronto**

Per vedere la differenza, puoi temporaneamente rinominare o rimuovere i file CSS:

```bash
# Rinomina per disabilitare
mv login/style.css login/style.css.bak
mv logout/style.css logout/style.css.bak

# Ricarica la pagina → vedrai stile Bootstrap di default

# Ripristina per riabilitare
mv login/style.css.bak login/style.css
mv logout/style.css.bak logout/style.css
```

## 🎨 Cosa Personalizza Questo CSS

### **Login (style.css)**

| Elemento | Personalizzazione |
|----------|-------------------|
| **Body** | Sfondo sfumato viola-blu |
| **Container** | Effetto glassmorphism |
| **Card** | Bordi arrotondati, ombra, animazione zoom-in |
| **Titolo** | Colore viola, ombra, animazione fade-down |
| **Input** | Bordi personalizzati, effetto focus con transform |
| **Bottone** | Gradiente viola, effetto hover 3D |
| **Errori** | Background rosso chiaro, bordo sinistro |

### **Logout (style.css)**

| Elemento | Personalizzazione |
|----------|-------------------|
| **Body** | Sfondo sfumato rosso-arancione |
| **Card** | Animazione fade-in |
| **Titolo** | Colore rosso, icona 👋 |
| **Bottone** | Gradiente rosso-rosa |

## 🔧 Come Estendere

### **Aggiungere CSS personalizzato per altre pagine**

1. Crea directory per il nuovo endpoint:
```bash
mkdir -p themes/placeholderExample/pluginsEndpointsMarkup/adminUsers/userProfile
```

2. Crea file CSS:
```bash
echo "body { background: green; }" > themes/placeholderExample/pluginsEndpointsMarkup/adminUsers/userProfile/style.css
```

3. Assicurati che il template usi `customCss`:
```ejs
<% if (customCss) { %>
  <style><%- customCss %></style>
<% } %>
```

4. Riavvia il server e visita `/api/adminUsers/userProfile`

### **Creare template custom completo**

Oltre al CSS, puoi sovrascrivere completamente il template:

```bash
# Copia template originale
cp plugins/adminUsers/webPages/login.ejs \
   themes/placeholderExample/pluginsEndpointsMarkup/adminUsers/login/template.ejs

# Modifica come preferisci
nano themes/placeholderExample/pluginsEndpointsMarkup/adminUsers/login/template.ejs
```

Il sistema userà automaticamente `template.ejs` invece del template di default del plugin.

## 📊 Architettura Completa

```
┌─────────────────────────────────────────────────────────────┐
│  RICHIESTA: GET /api/adminUsers/login                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│  PLUGIN main.js (Route Handler)                             │
│  ↓                                                           │
│  customCss = themeSys.getPluginCustomCss('adminUsers',      │
│                                          'login')            │
│  ↓                                                           │
│  themeSys cerca:                                            │
│    themes/placeholderExample/pluginsEndpointsMarkup/        │
│           adminUsers/login/style.css                        │
│  ↓                                                           │
│  Se esiste → Legge contenuto → customCss = "body { ... }"  │
│  Se NON esiste → customCss = ""                            │
│  ↓                                                           │
│  ejsData.customCss = customCss                              │
│  ↓                                                           │
│  ejs.renderFile('login.ejs', ejsData)                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│  TEMPLATE login.ejs                                          │
│  ↓                                                           │
│  <% if (customCss) { %>                                     │
│    <style><%- customCss %></style>                          │
│  <% } %>                                                     │
│  ↓                                                           │
│  Inietta CSS inline nell'HTML                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│  HTML FINALE INVIATO AL BROWSER                             │
│  ↓                                                           │
│  <head>                                                      │
│    <link rel="stylesheet" href="/api/bootstrap/...">        │
│    <style>                                                   │
│      body { background: linear-gradient(...); }             │
│      .card { ... }                                           │
│      /* Tutto il CSS personalizzato qui */                  │
│    </style>                                                  │
│  </head>                                                     │
└─────────────────────────────────────────────────────────────┘
```

## ✅ Vantaggi di Questo Sistema

1. ✅ **Separazione tema/plugin**: Il plugin non ha CSS hardcoded
2. ✅ **Personalizzazione senza modificare plugin**: Cambi solo file nel tema
3. ✅ **Temi multipli**: Ogni tema può avere stili diversi per lo stesso plugin
4. ✅ **Fallback automatico**: Se il tema non ha CSS, usa stile Bootstrap di default
5. ✅ **Hot-reload temi**: Cambi tema in config e riavvi → nuovo stile
6. ✅ **Zero configurazione plugin**: Il plugin chiama solo `getPluginCustomCss()`

## 🚀 Prossimi Passi

Questa è una **demo base**. Il sistema può essere esteso per:

- ✅ Iniettare JavaScript custom
- ✅ Sovrascrivere completamente template
- ✅ Aggiungere immagini/font personalizzati
- ✅ Creare varianti multiple per lo stesso endpoint

---

**Data creazione:** 2026-01-07
**Tema:** placeholderExample
**Plugin:** adminUsers
**Versione ital8cms:** 0.0.1-alpha.0
