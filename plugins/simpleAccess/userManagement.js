const fs = require('fs');
const path = require('path');
const bcryptjs = require('bcryptjs');
const { error } = require('console');



// Percorso del file utenti 
const usersFilePath = path.join(__dirname, 'userAccount.json');

// Funzione per validare l'email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Funzione per aggiungere un nuovo utente
async function addUser(username, password, email) {
    if (!username || !password || !email) {
        return { error: 'Errore: Devi specificare username, password ed email.', errorType: 'all' };
    }

    if (username.length < 3) {
        return { error: 'Errore: Lo username deve essere composto da almeno 3 caratteri.', errorType: 'username' };
    }

    if (!isValidEmail(email)) {
        return { error: 'Errore: L\'email non è in un formato valido.', errorType: 'email' };
    }

    // Crea l'hash della password
    const hashedPassword = await bcryptjs.hash(password, 10);

    
    const userAccount = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'))
    const users = Object.keys(userAccount.users);// converto le chiavi deglu utenti(nomi utenti) in un array
    const userEmails = Object.values(userAccount.users).map(user => user.email);// converto gli utenti in un array di oggetti e prendo solo le email
    /* if (fs.existsSync(usersFilePath)) {//POTREI CONTROLLARE SE IL FILE  ESISTE
      } */

    // Controlla se l'utente o l'email esistono già
    if (users.find(user => user === username)) {
        return { error: `Errore: L'utente "${username}" esiste già.`, errorType: 'username' };
    }

    if (userEmails.find(userEmail => userEmail === email)) {
        return { error: `Errore: L'email "${email}" è già in uso.`, errorType: 'email' };
    }

    // Aggiungi il nuovo utente
    userAccount.users[username] = { hashPassword: hashedPassword, email };

    // Salva il file aggiornato
    //fs.writeFileSync(usersFilePath, JSON.stringify(userAccount, null, 2));
    console.log('userAccount:', userAccount);
    return { success: `Utente "${username}" creato con successo.` };
}

module.exports = {
    addUser: addUser
}