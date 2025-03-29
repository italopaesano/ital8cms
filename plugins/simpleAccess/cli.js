#!/usr/bin/env node

const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');




// Leggi i parametri dalla riga di comando
const [,, command, username, password] = process.argv;

if (command === 'addUser') {
    addUser(username, password);
} else {
    console.log('Comando non riconosciuto. Usa:');
    console.log('  addUser <username> <password>  - Per creare un nuovo utente');
}