const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');
const escapeHtml = require('../../core/escapeHtml');

// Percorso del file ruoli
const rolesFilePath = path.join(__dirname, 'userRole.json5');
const usersFilePath = path.join(__dirname, 'userAccount.json5');

/**
 * Costruisce il messaggio che spiega perché un ruolo di sistema non si tocca.
 *
 * ─── DECISIONE D5 ────────────────────────────────────────────────────────────
 * `isHardcoded` resta il **guardiano unico**: è la fonte di verità dichiarata
 * dallo schema dei ruoli, ed è verificata funzionante (`deleteCustomRole(0)` e
 * `deleteCustomRole("0")` sono entrambi respinti — la stringa è la forma che
 * manda il form admin). Il floor `roleId >= 100` non è stato aggiunto: sarebbe
 * un secondo strato che duplica la stessa regola in un posto diverso, e due
 * fonti di verità sullo stesso confine divergono prima o poi.
 *
 * Quello che è cambiato è il **messaggio**. Diceva
 * « Non puoi modificare un ruolo di sistema (hardcoded) »: vero, ma non dice
 * quale ruolo, non dice perché, e « hardcoded » è gergo che non aggiunge nulla a
 * « di sistema ». Chi lo leggeva sapeva solo di aver sbattuto contro un muro.
 *
 * ─── UN MESSAGGIO SOLO PER MODIFICA ED ELIMINAZIONE ──────────────────────────
 * Il testo NON nomina l'azione: dice che quel ruolo non si può *né* modificare
 * *né* eliminare, perché è la stessa regola e sono la stessa risposta. L'azione
 * concretamente tentata viaggia a parte, nel campo `refusedAction` della
 * risposta, così l'interfaccia può mostrarla dove vuole senza che il testo
 * debba esistere in due varianti che possono divergere.
 *
 * SICUREZZA DELL'OUTPUT: il nome del ruolo finisce in questo testo, e i nomi
 * vivono in `userRole.json5` — file vivo, git-ignored, modificabile a mano.
 * I due punti di rendering della GUI sono `element.textContent = result.error`
 * e `alert(result.error)`: **nessuno dei due interpreta HTML**, quindi il nome
 * non va escapato (lo escaping produrrebbe `&amp;` letterali dentro un alert).
 * Se un domani quel rendering passasse a `innerHTML`, questo testo va escapato
 * con `escapeHtml` — è la ragione per cui la nota sta qui e non in un commit.
 *
 * @param {number} roleId - ID del ruolo di sistema toccato
 * @param {object} role - Il ruolo, come sta in userRole.json5
 * @returns {string}
 */
function spiegaRuoloDiSistema(roleId, role) {
    const nome = (role && role.name) ? role.name : `ID ${roleId}`;
    return (
        `Errore: "${nome}" (ID ${roleId}) è un ruolo di sistema: non si può né modificare né eliminare.\n` +
        `I ruoli di sistema (ID 0-3: root, admin, editor, selfEditor) sono parte del modello di accessi ` +
        `del CMS, e il codice li verifica per numero.\n` +
        `Per un ruolo su misura creane uno custom: riceve un ID da 100 in su, ed è modificabile ed eliminabile.`
    );
}

/**
 * Ottiene il prossimo ID disponibile per ruoli custom (>= 100)
 */
function getNextCustomRoleId() {
    const roleData = loadJson5(rolesFilePath);
    const roleIds = Object.keys(roleData.roles).map(id => parseInt(id));

    // Trova il massimo ID >= 100
    const customIds = roleIds.filter(id => id >= 100);

    if (customIds.length === 0) {
        return 100; // Primo ruolo custom
    }

    return Math.max(...customIds) + 1;
}

/**
 * Crea un nuovo ruolo custom
 * @param {string} name - Nome del ruolo (es. "moderator")
 * @param {string} description - Descrizione del ruolo
 * @returns {object} - {success: ..., roleId: ...} oppure {error: ...}
 */
function createCustomRole(name, description) {
    if (!name || !description) {
        return { error: 'Errore: Devi specificare nome e descrizione del ruolo.', errorType: 'all' };
    }

    // Validazione nome: solo lettere, numeri, underscore e trattini
    const validNameRegex = /^[A-Za-z0-9_\-]+$/;
    if (!validNameRegex.test(name)) {
        return { error: 'Errore: Il nome del ruolo può contenere solo lettere, numeri, underscore e trattini.', errorType: 'name' };
    }

    if (name.length < 3) {
        return { error: 'Errore: Il nome del ruolo deve essere di almeno 3 caratteri.', errorType: 'name' };
    }

    const roleData = loadJson5(rolesFilePath);

    // Controlla se il nome esiste già (case insensitive)
    const existingNames = Object.values(roleData.roles).map(r => r.name.toLowerCase());
    if (existingNames.includes(name.toLowerCase())) {
        return { error: `Errore: Esiste già un ruolo con nome "${name}".`, errorType: 'name' };
    }

    // Genera nuovo ID
    const newRoleId = getNextCustomRoleId();

    // Crea il nuovo ruolo
    roleData.roles[newRoleId] = {
        name: name,
        description: description,
        isHardcoded: false
    };

    // Salva il file aggiornato
    writeJson5Atomic(rolesFilePath, roleData);

    return { success: `Ruolo "${name}" creato con successo con ID ${newRoleId}.`, roleId: newRoleId };
}

/**
 * Distingue un roleId ASSENTE da uno presente.
 *
 * PERCHÉ ESISTE. Il controllo era `if (!roleId)`, che legge il NUMERO 0 come
 * "non fornito" — e 0 è l'ID di `root`, il ruolo più privilegiato. Il rifiuto
 * avveniva comunque (nessun ruolo di sistema è mai stato toccato), ma il
 * messaggio mentiva: diceva « devi specificare il roleId » a chi l'aveva
 * specificato, e su update restituiva `errorType: 'all'` invece di `'roleId'`,
 * cioè evidenziava il campo sbagliato nel form.
 *
 * La divergenza fra `0` e `"0"` — la stringa è truthy e prendeva il ramo giusto —
 * è la prova che si trattava di un errore di controllo e non di una scelta.
 *
 * La stringa vuota conta come assente: è ciò che invia un campo di form lasciato
 * in bianco.
 *
 * @param {*} roleId - Valore ricevuto dal chiamante
 * @returns {boolean} - true se il roleId non è stato fornito
 */
function isRoleIdAbsent(roleId) {
    return roleId === undefined || roleId === null || roleId === '';
}

/**
 * Scrittura ATOMICA di un file di dati: temp + rename.
 *
 * L'atomicità è la regola 1 di `CLAUDE.md`, e qui non è formalismo: si riscrivono
 * i ruoli e gli account dell'INTERA installazione, e una scrittura interrotta a
 * metà (disco pieno, processo ucciso) lascerebbe un file troncato che al boot
 * successivo `loadJson5` non legge più — nessun utente, nessun ruolo, pannello
 * admin irraggiungibile. Il `rename` è atomico sullo stesso filesystem: o il file
 * nuovo è completo, o resta quello vecchio.
 *
 * ─── PERCHÉ RISERIALIZZA, ED È VOLUTO ────────────────────────────────────────
 * `JSON.stringify` dell'oggetto intero **azzera i commenti** del file vivo:
 * misurato, `userRole.json5` passa da 15 righe con commento a 0 alla prima
 * modifica di un ruolo dal pannello.
 *
 * È la stessa forma della decisione D1 (`ConfigWizard.saveConfig()`), dove la
 * scelta è stata l'opposta — scrittura chirurgica chiave per chiave. Qui il
 * maintainer ha deciso diversamente, e la differenza è nella natura dei file:
 * `userRole.json5` e `userAccount.json5` sono **dati**, non configurazione. Non
 * sono scritti da una persona per essere riletti da una persona; sono scritti dal
 * codice a ogni operazione sul pannello, con creazioni e CANCELLAZIONI di chiavi
 * annidate (`roles.<id>`) che una scrittura chirurgica non saprebbe fare — e la
 * loro documentazione vive nei `.default`, che nessun codice riscrive mai.
 *
 * Conseguenza dichiarata: **i file di dati non portano commenti**, e i loro
 * `.default` non portano l'intestazione JSON5 dei file di configurazione. Vedi
 * `CLAUDE.md`, *Strategia di archiviazione dati*.
 *
 * @param {string} filePath - Path del file da riscrivere
 * @param {object} data - Oggetto da serializzare
 */
function writeJson5Atomic(filePath, data) {
    const tempPath = filePath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
}

/**
 * Aggiorna un ruolo custom esistente
 * @param {number} roleId - ID del ruolo da modificare
 * @param {string} name - Nuovo nome
 * @param {string} description - Nuova descrizione
 * @returns {object} - {success: ...} oppure {error: ...}
 */
function updateCustomRole(roleId, name, description) {
    if (isRoleIdAbsent(roleId) || !name || !description) {
        return { error: 'Errore: Devi specificare roleId, nome e descrizione.', errorType: 'all' };
    }

    roleId = parseInt(roleId);

    const roleData = loadJson5(rolesFilePath);

    // Verifica che il ruolo esista
    if (!roleData.roles[roleId]) {
        return { error: `Errore: Ruolo con ID ${roleId} non trovato.`, errorType: 'roleId' };
    }

    // Verifica che sia un ruolo custom (non hardcoded).
    // `isHardcoded` è il guardiano unico — vedi spiegaRuoloDiSistema().
    if (roleData.roles[roleId].isHardcoded) {
        return {
            error: spiegaRuoloDiSistema(roleId, roleData.roles[roleId]),
            errorType: 'roleId',
            refusedAction: 'modifica',
        };
    }

    // Validazione nome — le STESSE due regole di createCustomRole.
    //
    // La lunghezza minima mancava, quindi i due ingressi allo stesso campo non
    // concordavano su cosa fosse un nome valido: creare un ruolo "ab" era
    // rifiutato, ma crearne uno "moderator" e poi rinominarlo in "a" passava.
    // Il messaggio è identico a quello di createCustomRole di proposito: due
    // testi diversi per la stessa regola fanno cercare una differenza che non c'è.
    const validNameRegex = /^[A-Za-z0-9_\-]+$/;
    if (!validNameRegex.test(name)) {
        return { error: 'Errore: Il nome del ruolo può contenere solo lettere, numeri, underscore e trattini.', errorType: 'name' };
    }

    if (name.length < 3) {
        return { error: 'Errore: Il nome del ruolo deve essere di almeno 3 caratteri.', errorType: 'name' };
    }

    // Controlla se il nome esiste già in altri ruoli
    const existingRole = Object.entries(roleData.roles).find(
        ([id, role]) => parseInt(id) !== roleId && role.name.toLowerCase() === name.toLowerCase()
    );
    if (existingRole) {
        return { error: `Errore: Esiste già un ruolo con nome "${name}".`, errorType: 'name' };
    }

    // Aggiorna il ruolo
    roleData.roles[roleId].name = name;
    roleData.roles[roleId].description = description;

    // Salva il file aggiornato
    writeJson5Atomic(rolesFilePath, roleData);

    return { success: `Ruolo "${name}" aggiornato con successo.` };
}

/**
 * Elimina un ruolo custom
 * Rimuove anche il ruolo da tutti gli utenti che lo hanno assegnato
 * @param {number} roleId - ID del ruolo da eliminare
 * @returns {object} - {success: ..., affectedUsers: ...} oppure {error: ...}
 */
function deleteCustomRole(roleId) {
    if (isRoleIdAbsent(roleId)) {
        return { error: 'Errore: Devi specificare il roleId.', errorType: 'roleId' };
    }

    roleId = parseInt(roleId);

    const roleData = loadJson5(rolesFilePath);

    // Verifica che il ruolo esista
    if (!roleData.roles[roleId]) {
        return { error: `Errore: Ruolo con ID ${roleId} non trovato.`, errorType: 'roleId' };
    }

    // Verifica che sia un ruolo custom (non hardcoded).
    // Stesso messaggio della modifica, di proposito: è la stessa regola.
    if (roleData.roles[roleId].isHardcoded) {
        return {
            error: spiegaRuoloDiSistema(roleId, roleData.roles[roleId]),
            errorType: 'roleId',
            refusedAction: 'eliminazione',
        };
    }

    const roleName = roleData.roles[roleId].name;

    // Rimuovi il ruolo dal file
    delete roleData.roles[roleId];
    writeJson5Atomic(rolesFilePath, roleData);

    // Rimuovi il roleId da tutti gli utenti che lo hanno
    const userData = loadJson5(usersFilePath);
    let affectedUsers = [];

    Object.keys(userData.users).forEach(username => {
        const user = userData.users[username];
        if (user.roleIds && user.roleIds.includes(roleId)) {
            // Rimuovi il roleId dall'array
            user.roleIds = user.roleIds.filter(id => id !== roleId);
            affectedUsers.push(username);
        }
    });

    // Salva il file utenti aggiornato
    if (affectedUsers.length > 0) {
        writeJson5Atomic(usersFilePath, userData);
    }

    return {
        success: `Ruolo "${roleName}" eliminato con successo.`,
        affectedUsers: affectedUsers,
        affectedCount: affectedUsers.length
    };
}

/**
 * Ottiene la lista di tutti i ruoli custom (isHardcoded: false)
 * @returns {array} - Array di ruoli custom
 */
function getCustomRoles() {
    const roleData = loadJson5(rolesFilePath);
    const customRoles = [];

    Object.entries(roleData.roles).forEach(([roleId, role]) => {
        if (!role.isHardcoded) {
            customRoles.push({
                id: parseInt(roleId),
                name: escapeHtml(role.name),
                description: escapeHtml(role.description),
                isHardcoded: role.isHardcoded
            });
        }
    });

    return customRoles;
}

/**
 * Ottiene la lista di tutti i ruoli hardcoded (isHardcoded: true)
 * @returns {array} - Array di ruoli hardcoded
 */
function getHardcodedRoles() {
    const roleData = loadJson5(rolesFilePath);
    const hardcodedRoles = [];

    Object.entries(roleData.roles).forEach(([roleId, role]) => {
        if (role.isHardcoded) {
            hardcodedRoles.push({
                id: parseInt(roleId),
                name: escapeHtml(role.name),
                description: escapeHtml(role.description),
                isHardcoded: role.isHardcoded
            });
        }
    });

    return hardcodedRoles;
}

module.exports = {
    createCustomRole,
    updateCustomRole,
    deleteCustomRole,
    getCustomRoles,
    getHardcodedRoles,
    getNextCustomRoleId,
    isRoleIdAbsent
};
