// adminMedia plugin — gestione media file (immagini, video, audio)
// Vedi ROADMAP.md per dettaglio features e piano implementazione

'use strict';

const path = require('path');
const loadJson5 = require('../../core/loadJson5');

let pluginConfig = loadJson5(path.join(__dirname, 'pluginConfig.json5'));

// Riferimenti inizializzati al loadPlugin
let mediaDir = null; // Percorso assoluto della directory media

module.exports = {

  async loadPlugin(pluginSys, pathPluginFolder) {
    // TODO: Step 1 — leggere wwwPath da ital8Config.json5, costruire mediaDir, creare se non esiste
  },

  getRouteArray() {
    // TODO: Step 5 — API routes (list, upload, createFolder, rename, move, deleteFile, deleteFolder)
    return [];
  },

  getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) {
    // TODO: futura integrazione con plugin media (shared object)
    return {};
  },

  setSharedObject(fromPlugin, sharedObject) {
    // nessuna dipendenza inter-plugin al momento
  },

  getObjectToShareToWebPages() {
    return {};
  },

};
