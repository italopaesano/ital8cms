# Theme Assets

Questa cartella contiene gli asset statici del tema (CSS, JavaScript, immagini, font).

## Struttura

```
assets/
├── css/           # Fogli di stile CSS
│   └── theme.css  # Stili principali del tema
├── js/            # File JavaScript
│   └── theme.js   # Script principali del tema
├── images/        # Immagini del tema
└── fonts/         # Font personalizzati
```

## Come utilizzare gli asset

Gli asset sono accessibili tramite il prefix URL `/theme-assets/`.

### Nel partial head.ejs (per CSS):

```ejs
<%- passData.pluginSys.hookPage("head", passData); %>
<link rel="stylesheet" href="/theme-assets/css/theme.css">
```

### Nel partial footer.ejs (per JavaScript):

```ejs
<script src="/theme-assets/js/theme.js"></script>
<%- passData.pluginSys.hookPage("script", passData); %>
```

### Per le immagini:

```html
<img src="/theme-assets/images/logo.png" alt="Logo">
```

### Per i font:

```css
@font-face {
  font-family: 'MyCustomFont';
  src: url('/theme-assets/fonts/myfont.woff2') format('woff2');
}
```

## Note

- Gli asset vengono serviti automaticamente dal sistema
- Il path `/theme-assets/` punta sempre alla cartella assets del tema attivo
- Se si cambia tema, gli asset serviti cambieranno automaticamente
