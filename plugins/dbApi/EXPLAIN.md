# questi dbApi si baanosul modulo better-sqlite3

## il modulo db fornira a gli altri plugin in sharedObject.adApi.db un database riservato ad ogni modulo 
###  db: new betterSqlite3(`${__dirname}/dbFile/pluginsDb/${pluginName}.db`, { verbose: console.log })

## mentre per il template engine setterà un datase appposta per il web
### webDb = new betterSqlite3(`${__dirname}/dbFile/webDb.db`, { verbose: console.log });
### nel template engine questo databse si troverà sotto passData.plugin.adApi.db

