const fs = require('fs');
const path = require('path');
const bcryptjs = require('bcryptjs');
const { error } = require('console');
const loadJson5 = require('../../core/loadJson5');



// Percorso del file utenti
const usersFilePath = path.join(__dirname, 'userAccount.json5');

// Funzione per validare l'email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}


// sNewUser = true -> se stai cercando di creare un nuovo utente allora ti dovrai assicurare che questo utente non esista già
async function userUsert(username, password, email, roleId, isNewUser = true) { 
    if (!username || !password || !email || !roleId) {
        return { error: 'Errore: Devi specificare username, password, email e roleId.', errorType: 'all' };
    }

    // Controlla che lo username non contenga spazi
    if (/\s/.test(username)) {
        return { error: 'Errore: Lo username non può contenere spazi.', errorType: 'username' };
    }

    // Controlla che lo username contenga solo caratteri ammessi negli indici dello standard JSON
    const validUsernameRegex = /^[A-Za-z0-9_\-]+$/;
    if (!validUsernameRegex.test(username)) {
        return { error: 'Errore: Lo username contiene caratteri non ammessi. Sono permessi solo lettere, numeri, underscore e trattini.', errorType: 'username' };
    }

    if (username.length < 3) {
        return { error: 'Errore: Lo username deve essere composto da almeno 3 caratteri.', errorType: 'username' };
    }

    if (!isValidEmail(email)) {
        return { error: 'Errore: L\'email non è in un formato valido.', errorType: 'email' };
    }

    // Crea l'hash della password
    const hashedPassword = await bcryptjs.hash(password, 10);

    const userAccount = loadJson5(usersFilePath);
    const users = Object.keys(userAccount.users); // converto le chiavi degli utenti (nomi utenti) in un array
    const userEmails = Object.values(userAccount.users).map(user => user.email); // converto gli utenti in un array di oggetti e prendo solo le email

    // isNewUser -> se devo creare un nuovo utente allora devo verificare che l'utente non esista già e che l'email non sia già in uso
    if (isNewUser) {
        // Controlla se l'utente o l'email esistono già
        if (users.find(user => user === username)) {
            return { error: `Errore: L'utente "${username}" esiste già.`, errorType: 'username' };
        }

        // Controlla se l'email è già in uso
        if (userEmails.find(userEmail => userEmail === email)) {
            return { error: `Errore: L'email "${email}" è già in uso.`, errorType: 'email' };
        }
    }else{// al contrario se l'utente è già presente allora l'utente deve esistere e la mail no deve essere usata da nessun altro utente
        // Controlla se l'utente esiste già
        if (!users.find(user => user === username)) {
            return { error: `Errore: L'utente "${username}" non esiste.`, errorType: 'username' };
        }

        // Controlla se l'email è già in uso da un altro utente
        if (userEmails.find(userEmail => userEmail === email && userAccount.users[username].email !== email)) {
            return { error: `Errore: L'email "${email}" è già in uso da un altro utente.`, errorType: 'email' };
        }
    }

    // Aggiungi il nuovo utente con il roleId
    userAccount.users[username] = { hashPassword: hashedPassword, email, roleId };

    // Salva il file aggiornato
    fs.writeFileSync(usersFilePath, JSON.stringify(userAccount, null, 2));
    //console.log('userAccount:', userAccount);
    return { success: `Utente "${username}" creato con successo.` };
}

module.exports = {
    userUsert: userUsert
}