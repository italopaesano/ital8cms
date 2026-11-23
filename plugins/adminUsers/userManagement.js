const fs = require('fs');
const path = require('path');
const bcryptjs = require('bcryptjs');
const { error } = require('console');
const loadJson5 = require('../../core/loadJson5');
const { updateJson5Serialized } = require('../../core/json5UpdateQueue');
const { validatePassword } = require('../../core/passwordPolicy');



// Percorso del file utenti
const usersFilePath = path.join(__dirname, 'userAccount.json5');

// Funzione per validare l'email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}


// sNewUser = true -> se stai cercando di creare un nuovo utente allora ti dovrai assicurare che questo utente non esista già
// roleIds DEVE essere un array di numeri [1,2] o [1]
async function userUsert(username, password, email, roleIds, isNewUser = true) {
    if (!username || !password || !email || !roleIds) {
        return { error: 'Errore: Devi specificare username, password, email e roleIds.', errorType: 'all' };
    }

    // Verifica che roleIds sia un array
    if (!Array.isArray(roleIds)) {
        return { error: 'Errore: roleIds deve essere un array di numeri.', errorType: 'roleIds' };
    }

    // Converti tutti gli elementi in numeri
    roleIds = roleIds.map(id => parseInt(id));

    // Controlla che lo username non contenga spazi
    if (/\s/.test(username)) {
        return { error: 'Errore: Lo username non può contenere spazi.', errorType: 'username' };
    }

    // Controlla che lo username contenga solo caratteri ammessi negli indici dello standard JSON
    // Denylist esplicita (REVIEW.md → B4). La regex qui sotto ACCETTA `__proto__`
    // — sono solo lettere e underscore — e `Object.keys()` non lo elenca, quindi
    // il controllo « esiste già? » passava. Poi `userAccount.users['__proto__'] =
    // {...}` non crea una proprietà: SOSTITUISCE il prototipo dell'oggetto.
    // `JSON.stringify` non serializza il prototipo, quindi il file veniva scritto
    // senza il nuovo utente — e la funzione rispondeva « creato con successo ».
    // Il sistema dichiarava di aver fatto una cosa che non aveva fatto.
    //
    // Sta PRIMA della regex perché l'errore deve arrivare presto e con un
    // messaggio comprensibile, invece di un rifiuto più a valle per un'altra
    // ragione.
    const RESERVED_USERNAMES = ['__proto__', 'constructor', 'prototype'];
    if (RESERVED_USERNAMES.includes(String(username))) {
        return {
            error: `Errore: "${username}" è un nome riservato del linguaggio e non può essere usato come username.`,
            errorType: 'username'
        };
    }

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

    // ── Policy CONDIVISA (REVIEW.md → C4) ────────────────────────────────────
    //
    // Qui prima NON c'era alcun controllo sulla password — e questo è il punto
    // che crea l'utente più privilegiato del sistema, incluso il primo root:
    // una password di un carattere veniva accettata senza obiezioni. Il wizard
    // ne pretendeva 8 con maiuscola, minuscola e cifra, e il profilo utente 6:
    // tre regole diverse per la stessa cosa, e la più permissiva era quella sul
    // percorso più privilegiato.
    //
    // Sta prima dell'hash: non si spendono 100 ms di bcrypt su una password che
    // va rifiutata.
    const esitoPassword = validatePassword(password);
    if (!esitoPassword.valid) {
        return { error: `Errore: ${esitoPassword.error}.`, errorType: 'password' };
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

    // ── Scrittura serializzata e atomica (REVIEW.md → B1) ────────────────────
    //
    // Prima era `fs.writeFileSync` diretto. `userAccount.json5` contiene TUTTI
    // gli account con i loro hash e ruoli, ed è git-ignored per scelta: non
    // esiste una copia nel repository da cui ripristinarlo. Una scrittura
    // troncata non è un disservizio, è la perdita dell'accesso al sistema.
    //
    // Il mutatore riceve il contenuto FRESCO dentro la coda del file, quindi
    // questa creazione non può più sovrascrivere una modifica arrivata durante
    // l'`await bcrypt.hash` qui sopra (B2: lo stesso schema, altro handler).
    // Nota: `userUsert` era « corretto per caso » — l'hash avveniva PRIMA della
    // lettura, quindi lettura e scrittura erano contigue. Un equilibrio che
    // dipendeva dall'ordine delle righe e che nessun commento segnalava.
    await updateJson5Serialized(usersFilePath, (fresh) => {
        if (!fresh.users) fresh.users = {};
        fresh.users[username] = { hashPassword: hashedPassword, email, roleIds };
        return fresh;
    });

    return { success: `Utente "${username}" creato con successo.` };
}

module.exports = {
    userUsert: userUsert
}