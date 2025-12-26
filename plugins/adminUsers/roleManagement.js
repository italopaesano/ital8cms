const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');

// Percorso del file ruoli
const rolesFilePath = path.join(__dirname, 'userRole.json5');
const usersFilePath = path.join(__dirname, 'userAccount.json5');

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
    fs.writeFileSync(rolesFilePath, JSON.stringify(roleData, null, 2));

    return { success: `Ruolo "${name}" creato con successo con ID ${newRoleId}.`, roleId: newRoleId };
}

/**
 * Aggiorna un ruolo custom esistente
 * @param {number} roleId - ID del ruolo da modificare
 * @param {string} name - Nuovo nome
 * @param {string} description - Nuova descrizione
 * @returns {object} - {success: ...} oppure {error: ...}
 */
function updateCustomRole(roleId, name, description) {
    if (!roleId || !name || !description) {
        return { error: 'Errore: Devi specificare roleId, nome e descrizione.', errorType: 'all' };
    }

    roleId = parseInt(roleId);

    const roleData = loadJson5(rolesFilePath);

    // Verifica che il ruolo esista
    if (!roleData.roles[roleId]) {
        return { error: `Errore: Ruolo con ID ${roleId} non trovato.`, errorType: 'roleId' };
    }

    // Verifica che sia un ruolo custom (non hardcoded)
    if (roleData.roles[roleId].isHardcoded) {
        return { error: 'Errore: Non puoi modificare un ruolo di sistema (hardcoded).', errorType: 'roleId' };
    }

    // Validazione nome
    const validNameRegex = /^[A-Za-z0-9_\-]+$/;
    if (!validNameRegex.test(name)) {
        return { error: 'Errore: Il nome del ruolo può contenere solo lettere, numeri, underscore e trattini.', errorType: 'name' };
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
    fs.writeFileSync(rolesFilePath, JSON.stringify(roleData, null, 2));

    return { success: `Ruolo "${name}" aggiornato con successo.` };
}

/**
 * Elimina un ruolo custom
 * Rimuove anche il ruolo da tutti gli utenti che lo hanno assegnato
 * @param {number} roleId - ID del ruolo da eliminare
 * @returns {object} - {success: ..., affectedUsers: ...} oppure {error: ...}
 */
function deleteCustomRole(roleId) {
    if (!roleId) {
        return { error: 'Errore: Devi specificare il roleId.', errorType: 'roleId' };
    }

    roleId = parseInt(roleId);

    const roleData = loadJson5(rolesFilePath);

    // Verifica che il ruolo esista
    if (!roleData.roles[roleId]) {
        return { error: `Errore: Ruolo con ID ${roleId} non trovato.`, errorType: 'roleId' };
    }

    // Verifica che sia un ruolo custom (non hardcoded)
    if (roleData.roles[roleId].isHardcoded) {
        return { error: 'Errore: Non puoi eliminare un ruolo di sistema (hardcoded).', errorType: 'roleId' };
    }

    const roleName = roleData.roles[roleId].name;

    // Rimuovi il ruolo dal file
    delete roleData.roles[roleId];
    fs.writeFileSync(rolesFilePath, JSON.stringify(roleData, null, 2));

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
        fs.writeFileSync(usersFilePath, JSON.stringify(userData, null, 2));
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
                name: role.name,
                description: role.description,
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
                name: role.name,
                description: role.description,
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
    getNextCustomRoleId
};
