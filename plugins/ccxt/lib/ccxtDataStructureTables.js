
//const betterSqlite3 = require('better-sqlite3');

function createCcxtDataStructureTables( sqlite3DB ){// sqlite3DB = db betterSqlite3 già aperto e pronto per scriverci dentro

    // questa tabbella conterrà i dati restituiti da : ccxt.exchanges = restituisce la lista degli exchanges supportati
    const exchanges = sqlite3DB.prepare(`
    CREATE TABLE IF NOT EXISTS exchanges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE
    )
    `);
    exchanges.run();

    // la seconda colonna è custom e nonfa parte della struttura originale = refIdExchanges INTEGER,
    //additionalInfo = conterrà tuti i dati serializati che potrebbero essere utili in furuto
    const fetchMarkets = sqlite3DB.prepare(`
    CREATE TABLE IF NOT EXISTS fetchMarkets (
        id TEXT PRIMARY KEY,

        refIdExchanges INTEGER,
        additionalInfo TEXT,

        symbol TEXT,
        base TEXT,
        quote TEXT,
        baseId TEXT,
        quoteId TEXT,
        active BOOLEAN
    )
    `);
    fetchMarkets.run();

    //ATTENZIONE DA APPROFONDIRE MOLTO
    const fetchOrderBook = sqlite3DB.prepare(`
    CREATE TABLE IF NOT EXISTS order_book_entries (
        id INTEGER PRIMARY KEY,
        market_symbol TEXT,
        order_type TEXT,
        price REAL,
        amount REAL,
        fetch_timestamp DATETIME
    )
    `);
    fetchOrderBook.run();


}

module.exports = {
    createCcxtDataStructureTables, createCcxtDataStructureTables
}