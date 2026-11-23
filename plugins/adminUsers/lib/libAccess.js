// in questo file vi sarà il codice per gesire l'a sessione .

const path = require('path');
const loadJson5 = require('../../../core/loadJson5');
const bcrypt = require('bcryptjs');// serve per calcolare l' hash della passord

const userAccountPath = path.join(__dirname, '../userAccount.json5');

/**
 * Hash valido ma di una password che nessuno conosce.
 *
 * Serve a pareggiare il TEMPO del ramo « utente inesistente » (REVIEW.md → C3):
 * prima, se lo username non esisteva, `bcrypt.compare` non veniva eseguito e la
 * risposta arrivava in pochi millisecondi, mentre per uno username valido ne
 * servivano ~100 — la lentezza è lo scopo di bcrypt. La differenza è misurabile
 * da fuori, quindi diceva a un estraneo QUALI username esistono.
 *
 * È una costante e non un hash calcolato al caricamento: calcolarlo costerebbe
 * ~100 ms a ogni boot per ottenere lo stesso effetto.
 */
const EQUALIZER_HASH = '$2b$10$gszyYxZsw6FFoAZsYFderu.07bfObh5O.w3/fJJqe.kfkk8g.PFRu';

async function autenticate( username ,password){

    // Carica i dati utente ad ogni chiamata per riflettere modifiche al file (es. utenti aggiunti da test o admin)
    const usersAccounts = loadJson5(userAccountPath);

    // Mappa SENZA prototipo (REVIEW.md → B4): indicizzare con input utente un
    // oggetto normale restituisce anche `constructor`, `toString`, `valueOf` e
    // compagnia, che sono *truthy*. Con `constructor` come username il controllo
    // di esistenza passava, `.hashPassword` era `undefined`, e
    // `bcrypt.compare(password, undefined)` RIGETTAVA — un 500 su un endpoint
    // pubblico e non autenticato, provocabile con una parola. Misurato: la stessa
    // cosa con `toString` e `__proto__`.
    const users = Object.assign(Object.create(null), usersAccounts.users || {});

    // `Object.hasOwn` è la difesa che copre la classe intera, non il caso singolo.
    const record = Object.hasOwn(users, username || '') ? users[username] : null;
    const storedHash = record && typeof record.hashPassword === 'string' ? record.hashPassword : null;

    if (!username || !password || !storedHash) {
        // Si confronta comunque, contro l'hash equalizzatore: il ramo « utente
        // inesistente » deve costare quanto quello « password sbagliata ».
        await bcrypt.compare(String(password || ''), EQUALIZER_HASH);
        return false;
    }

    return bcrypt.compare(password, storedHash);
}

module.exports = {
    autenticate: autenticate,
} 