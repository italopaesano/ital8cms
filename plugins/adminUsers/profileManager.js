const fs = require('fs');
const path = require('path');
const bcryptjs = require('bcryptjs');
const loadJson5 = require('../../core/loadJson5');

// Percorso del file utenti
const usersFilePath = path.join(__dirname, 'userAccount.json5');

// Funzione per validare l'email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Ottiene le informazioni del profilo di un utente
 * @param {string} username - Nome utente
 * @returns {object} - { success: dati utente } o { error: messaggio errore }
 */
function getProfile(username) {
    if (!username) {
        return { error: 'Username non specificato.' };
    }

    try {
        const userAccount = loadJson5(usersFilePath);

        if (!userAccount.users[username]) {
            return { error: `Utente "${username}" non trovato.` };
        }

        // Ritorna dati utente senza hashPassword
        const userData = {
            username: username,
            email: userAccount.users[username].email,
            roleIds: userAccount.users[username].roleIds
        };

        return { success: true, data: userData };
    } catch (error) {
        return { error: `Errore nel caricamento del profilo: ${error.message}` };
    }
}

/**
 * Aggiorna il profilo utente
 * @param {string} username - Nome utente (non modificabile)
 * @param {string} newEmail - Nuova email
 * @param {string} currentPassword - Password attuale (per verifica)
 * @param {string} newPassword - Nuova password (opzionale)
 * @returns {object} - { success: messaggio } o { error: messaggio, errorType: tipo }
 */
async function updateProfile(username, newEmail, currentPassword, newPassword = null) {
    if (!username || !newEmail || !currentPassword) {
        return { error: 'Errore: Devi specificare username, email e password attuale.', errorType: 'all' };
    }

    // Validazione email
    if (!isValidEmail(newEmail)) {
        return { error: 'Errore: L\'email non è in un formato valido.', errorType: 'email' };
    }

    try {
        const userAccount = loadJson5(usersFilePath);

        // Verifica che l'utente esista
        if (!userAccount.users[username]) {
            return { error: `Errore: L'utente "${username}" non esiste.`, errorType: 'username' };
        }

        // Verifica password attuale
        const storedHash = userAccount.users[username].hashPassword;
        const isPasswordValid = await bcryptjs.compare(currentPassword, storedHash);

        if (!isPasswordValid) {
            return { error: 'Errore: Password attuale non corretta.', errorType: 'currentPassword' };
        }

        // Controlla se la nuova email è già in uso da un altro utente
        const userEmails = Object.entries(userAccount.users)
            .filter(([user, _]) => user !== username)
            .map(([_, data]) => data.email);

        if (userEmails.includes(newEmail)) {
            return { error: `Errore: L'email "${newEmail}" è già in uso da un altro utente.`, errorType: 'email' };
        }

        // Aggiorna email
        userAccount.users[username].email = newEmail;

        // Aggiorna password se fornita
        if (newPassword && newPassword.trim() !== '') {
            if (newPassword.length < 6) {
                return { error: 'Errore: La nuova password deve essere di almeno 6 caratteri.', errorType: 'newPassword' };
            }
            const hashedPassword = await bcryptjs.hash(newPassword, 10);
            userAccount.users[username].hashPassword = hashedPassword;
        }

        // Salva il file aggiornato
        fs.writeFileSync(usersFilePath, JSON.stringify(userAccount, null, 2));

        return { success: `Profilo aggiornato con successo.` };
    } catch (error) {
        return { error: `Errore nell'aggiornamento del profilo: ${error.message}`, errorType: 'all' };
    }
}

module.exports = {
    getProfile: getProfile,
    updateProfile: updateProfile
};
