# Personalizzazione Endpoint Plugin

Questa directory permette ai temi di personalizzare l'aspetto degli endpoint dei plugin senza modificare il codice originale del plugin.

## Struttura

```
themes/{nomeTema}/plugins/
    {nomePlugin}/
        {nomeEndpoint}/
            template.ejs     # Template HTML/EJS personalizzato
            style.css        # CSS personalizzato
```

## Come Funziona

1. Quando un plugin carica un template per un endpoint, il sistema verifica prima se esiste una versione personalizzata nel tema attivo
2. Se esiste, usa il template personalizzato invece di quello di default del plugin
3. Il CSS personalizzato viene caricato automaticamente e reso disponibile come variabile `customCss` nel template

## Esempio: Personalizzazione Login

La pagina di login del plugin `simpleAccess` può essere personalizzata creando:

```
themes/default/plugins/
    simpleAccess/
        login/
            template.ejs     # Form di login personalizzato
            style.css        # Stili CSS personalizzati
```

## Variabili Disponibili nei Template

I template personalizzati hanno accesso alle stesse variabili del template originale, piu:

- `customCss` - Contenuto del file style.css del tema (per inclusione inline)

### Variabili comuni per simpleAccess:

- `apiPrefix` - Script per impostare la variabile apiPrefix
- `bootstrapCss` - Link CSS di Bootstrap
- `bootstrapJs` - Script JS di Bootstrap
- `referrerTo` - URL di ritorno dopo login/logout

## Creazione di un Template Personalizzato

1. **Copia il template originale** dal plugin come base
2. **Modifica l'aspetto** mantenendo la struttura del form e i campi necessari
3. **Aggiungi lo style tag** per includere il CSS personalizzato:

```ejs
<style>
  <%- customCss || '' %>
</style>
```

## API Disponibili in themeSys

I plugin possono usare questi metodi per supportare la personalizzazione:

```javascript
// Verifica se esiste un template personalizzato
themeSys.hasCustomPluginTemplate(pluginName, endpointName, templateFile, isAdmin)

// Ottieni il path del template personalizzato (o null)
themeSys.getCustomPluginTemplatePath(pluginName, endpointName, templateFile, isAdmin)

// Risolvi il path (custom se esiste, altrimenti default)
themeSys.resolvePluginTemplatePath(pluginName, endpointName, defaultPath, templateFile, isAdmin)

// Leggi il CSS personalizzato
themeSys.getPluginCustomCss(pluginName, endpointName, cssFile, isAdmin)

// Verifica se esiste un asset personalizzato
themeSys.hasCustomPluginAsset(pluginName, endpointName, assetFile, isAdmin)

// Lista plugin personalizzati nel tema
themeSys.getCustomizedPlugins(isAdmin)
```

## Come Aggiungere Supporto in un Plugin

Per permettere la personalizzazione degli endpoint nel proprio plugin:

```javascript
// Nel route handler
handler: async (ctx) => {
  const defaultTemplate = path.join(__dirname, 'webPages', 'myPage.ejs');

  let templatePath = defaultTemplate;
  let customCss = '';

  if (myPluginSys) {
    const themeSys = myPluginSys.getThemeSys();
    if (themeSys) {
      templatePath = themeSys.resolvePluginTemplatePath(
        'myPlugin',
        'myEndpoint',
        defaultTemplate,
        'template.ejs'
      );
      customCss = themeSys.getPluginCustomCss('myPlugin', 'myEndpoint');
    }
  }

  const data = { ...ejsData, customCss };
  ctx.body = await ejs.renderFile(templatePath, data);
}
```

## Plugin con Supporto alla Personalizzazione

- **simpleAccess**
  - `login` - Pagina di login
  - `logout` - Pagina di logout

## Note

- I template personalizzati devono mantenere i campi del form necessari per il funzionamento del plugin
- Il CSS viene incluso inline nel template per evitare richieste HTTP aggiuntive
- Per asset esterni (immagini, JS), usare la directory `assets/` del tema
