#!/usr/bin/env bash
#
# generateTestPlugins.sh
#
# Genera un plugin "ciccione" pronto da inizializzare come repo git e pushare
# su GitHub, per testare visivamente la barra di progress dell'installazione
# plugin nel pannello admin di ital8cms.
#
# Il plugin generato contiene:
#   - Struttura minima valida (main.js, pluginConfig.json5, pluginDescription.json5)
#   - Una singola rotta GET /api/<name>/ping per verificare il caricamento
#   - 1 blob binario incompressibile da 5 MB (rallenta la fase 'Receiving
#     objects' facendo avanzare la percentuale e il contatore bytes in modo
#     visibile)
#   - 200 piccoli file (rallentano la fase 'Updating files' producendo molti
#     update X/200 del contatore checkout)
#
# Risultato atteso al clone via 'git clone --progress': barra visibile per
# ~2-3 secondi su rete domestica, con transizione visibile tra gli stadi.
#
# Naming (convenzione del modulo pluginsInstall):
#   Repo:    ital8cms-plugin-pluginForTest  →  cartella plugin: pluginForTest
#
# Nota: a differenza dei temi (che hanno la dicotomia public/admin in base al
# flag isAdminTheme), per i plugin la convenzione admin è data dal nome che
# inizia per "admin" — questo script genera un plugin regolare. Per generare
# anche un plugin admin di test in futuro, basterà cambiare PLUGIN_NAME in
# "admin<Qualcosa>" e aggiungere "adminSections": [...] in pluginConfig.json5
# (vedi commento nella funzione write_plugin_config).
#
# Usage:
#   bash scripts/generateTestPlugins.sh [outputDir]
#   (default outputDir: ./test-plugins-output)

set -euo pipefail

OUT_DIR="${1:-./test-plugins-output}"
BLOB_SIZE_MB=5
SMALL_FILES_COUNT=200
PLUGIN_NAME="pluginForTest"

# ----- helpers -------------------------------------------------------------

c_green=$'\033[32m'
c_cyan=$'\033[36m'
c_yellow=$'\033[33m'
c_reset=$'\033[0m'

info()  { printf "${c_cyan}[info]${c_reset} %s\n" "$*"; }
ok()    { printf "${c_green}[ok]${c_reset}   %s\n" "$*"; }
warn()  { printf "${c_yellow}[warn]${c_reset} %s\n" "$*"; }

# ----- generators ----------------------------------------------------------

write_plugin_config() {
    local plugin_dir="$1"
    # Nota per estensioni future: se il plugin generato fosse admin (nome che
    # inizia per "admin"), aggiungere una chiave:
    #     "adminSections": ["sezioneEsempio"],
    # e creare la cartella adminWebSections/sezioneEsempio/index.ejs.
    # Per ora il plugin di test è volutamente regolare.
    cat > "$plugin_dir/pluginConfig.json5" <<EOF
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  // 'active' e 'isInstalled' vengono settati dal modulo pluginsInstall
  // durante l'installazione in base a wantActive e alla presenza di
  // dipendenze npm. I valori qui sono solo orientativi.
  "active": 0,
  "isInstalled": 0,
  "weight": 100,
  "dependency": {},
  "nodeModuleDependency": {},
  "version": "1.0.0",
  "custom": {},
}
EOF
}

write_plugin_description() {
    local plugin_dir="$1"
    local plugin_name="$2"
    cat > "$plugin_dir/pluginDescription.json5" <<EOF
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "name": "$plugin_name",
  "version": "1.0.0",
  "description": "Plugin di test per la barra di progress (volutamente ciccione).",
  "author": "Italo Paesano",
  "email": "italopaesano@protonmail.com",
  "license": "ISC",
}
EOF
}

write_main_js() {
    local plugin_dir="$1"
    local plugin_name="$2"
    # main.js deve essere require()-abile senza side effects al load: il
    # validatore (validateClonedPlugin) fa require(mainPath) per verificare
    # che il modulo non crashi al caricamento. Tutto il lavoro reale va in
    # loadPlugin() o nei route handler.
    cat > "$plugin_dir/main.js" <<EOF
/**
 * Plugin di test '$plugin_name' per la progress bar dell'installazione.
 *
 * Volutamente minimale: lo scopo di questo plugin è far girare il flusso
 * completo di install (clone, validate, finalize) contro un repository
 * ciccione che renda visibile la progress bar nel pannello admin.
 *
 * Espone una singola rotta GET /api/$plugin_name/ping che ritorna un
 * payload JSON con timestamp. Utile come smoke test post-install per
 * verificare che il plugin sia effettivamente caricato.
 *
 * Non usare in produzione.
 */
module.exports = {
  async loadPlugin(pluginSys, pathPluginFolder) {
    // Nessuna inizializzazione necessaria.
  },

  getRouteArray() {
    return [
      {
        method: 'GET',
        path: '/ping',
        access: { requiresAuth: false, allowedRoles: [] },
        handler: async (ctx) => {
          ctx.body = {
            ok: true,
            plugin: '$plugin_name',
            timestamp: Date.now(),
          };
        },
      },
    ];
  },
};
EOF
}

write_readme() {
    local plugin_dir="$1"
    local plugin_name="$2"
    cat > "$plugin_dir/README.md" <<EOF
# $plugin_name

Plugin di test, generato da \`scripts/generateTestPlugins.sh\` di ital8cms.

Volutamente "ciccione" (~6 MB) per rendere visibile la barra di progress
dell'installazione plugin da repo Git nel pannello admin di ital8cms.

## Cosa contiene

- Struttura minima valida per essere accettato da \`pluginsInstall\`:
  - \`main.js\` con rotta \`GET /ping\`
  - \`pluginConfig.json5\`
  - \`pluginDescription.json5\`
- Payload "ciccione" in \`lib/blob/\` e \`lib/assets/\` (5 MB di urandom +
  200 file di testo random) per stress-testare il clone.

## Smoke test dopo l'installazione

\`\`\`
GET /api/$plugin_name/ping
→ { "ok": true, "plugin": "$plugin_name", "timestamp": ... }
\`\`\`

Non usare in produzione.
EOF
}

write_gitignore() {
    local plugin_dir="$1"
    cat > "$plugin_dir/.gitignore" <<'EOF'
.DS_Store
*.tmp
node_modules/
EOF
}

generate_fat_payload() {
    local plugin_dir="$1"

    mkdir -p "$plugin_dir/lib/blob" "$plugin_dir/lib/assets"

    info "  generating ${BLOB_SIZE_MB}MB incompressible blob (urandom)..."
    dd if=/dev/urandom of="$plugin_dir/lib/blob/payload.bin" \
       bs=1M count=$BLOB_SIZE_MB status=none

    info "  generating $SMALL_FILES_COUNT small files (for 'Updating files' stage)..."
    # Pool di entropia generato una volta sola e spezzettato: evita 200
    # spawn di dd/openssl che renderebbero la generazione lenta.
    local pool
    pool=$(head -c $(( SMALL_FILES_COUNT * 200 )) /dev/urandom | base64)
    local pool_len=${#pool}
    local chunk=200
    for i in $(seq 1 $SMALL_FILES_COUNT); do
        printf -v idx "%04d" "$i"
        local offset=$(( (i - 1) * chunk % (pool_len - chunk) ))
        local content="${pool:$offset:$chunk}"
        printf 'File %s\n%s\n' "$idx" "$content" \
            > "$plugin_dir/lib/assets/file-$idx.txt"
    done
}

# ----- main ----------------------------------------------------------------

create_plugin() {
    local plugin_name="$1"
    local repo_segment="$2"
    local plugin_dir="$OUT_DIR/$plugin_name"

    info "Generating plugin '$plugin_name' → $plugin_dir"

    if [ -e "$plugin_dir" ]; then
        warn "  $plugin_dir esiste già: lo rimuovo prima di ricrearlo."
        rm -rf "$plugin_dir"
    fi

    mkdir -p "$plugin_dir"

    write_plugin_config "$plugin_dir"
    write_plugin_description "$plugin_dir" "$plugin_name"
    write_main_js "$plugin_dir" "$plugin_name"
    write_readme "$plugin_dir" "$plugin_name"
    write_gitignore "$plugin_dir"
    generate_fat_payload "$plugin_dir"

    local size
    size=$(du -sh "$plugin_dir" | cut -f1)
    ok "  Plugin '$plugin_name' pronto ($size). Repo GitHub atteso: ital8cms-plugin-$repo_segment"
}

main() {
    mkdir -p "$OUT_DIR"
    info "Output dir: $OUT_DIR"
    info "Config: blob=${BLOB_SIZE_MB}MB, small files=$SMALL_FILES_COUNT"
    echo

    create_plugin "$PLUGIN_NAME" "$PLUGIN_NAME"
    echo

    cat <<EOF
${c_green}Generazione completata.${c_reset}

Prossimi passi:

  cd $OUT_DIR/$PLUGIN_NAME
  git init
  git add .
  git commit -m "Initial commit: dummy plugin for progress bar testing"
  git branch -M main
  # Crea il repo su GitHub con nome 'ital8cms-plugin-$PLUGIN_NAME'
  git remote add origin https://github.com/<USER>/ital8cms-plugin-$PLUGIN_NAME.git
  git push -u origin main

Poi nel pannello admin ital8cms (/admin/pluginsManagment/install.ejs) inserisci:
  https://github.com/<USER>/ital8cms-plugin-$PLUGIN_NAME.git

Smoke test post-install:
  curl http://localhost:3000/api/$PLUGIN_NAME/ping

Nota: il push di ~6MB su GitHub può richiedere qualche secondo a seconda
della banda in upload. Il clone dal pannello admin di ital8cms invece
mostrerà la barra di progress per circa 2-3 secondi su connessione fibra.

Una volta pushato il repo, potrai aggiungere un test di integrazione contro
il repo reale specchio di plugins/admin/tests/integration/themesInstall.realRepo.test.js
(cambiando URL, prefix e nome plugin).
EOF
}

main "$@"
