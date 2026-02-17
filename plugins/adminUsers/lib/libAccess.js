// in questo file vi sarà il codice per gesire l'a sessione .

const path = require('path');
const loadJson5 = require('../../../core/loadJson5');
const bcrypt = require('bcryptjs');// serve per calcolare l' hash della passord

const userAccountPath = path.join(__dirname, '../userAccount.json5');

async function autenticate( username ,password){

    // Carica i dati utente ad ogni chiamata per riflettere modifiche al file (es. utenti aggiunti da test o admin)
    const usersAccounts = loadJson5(userAccountPath);

    if(!username || !password || !usersAccounts.users[username]){// se non è presente l'utente  omanca qualche dato ritorna false
        return false;
    }

    const storedHash = usersAccounts.users[username].hashPassword;
    const isMatch = await bcrypt.compare(password, storedHash);

    if(!isMatch){
        return false;
    }else{
        return true;
    }

}

module.exports = {
    autenticate: autenticate,
} 