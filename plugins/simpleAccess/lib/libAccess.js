// in questo file vi sarà il codice per gesire l'a sessione .

const path = require('path');
const loadJson5 = require('../../../core/loadJson5');
const bcrypt = require('bcryptjs');// serve per calcolare l' hash della passord
const usersAccounts = loadJson5(path.join(__dirname, '../userAccount.json'));

async function autenticate( username ,password){

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