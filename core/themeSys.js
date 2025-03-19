
const ejs = require('ejs');
//let ital8Conf;

class themeSys{

  //#fnInPageMap;// variabile privata

  constructor( theItal8Conf , activeTheme = theItal8Conf.activeTheme ){// OLD OpluginSys. incorpora un istanza della classe pluginSys quindi un oggetto pluginSys da questo la O grande iniziale
    this.ital8Conf = theItal8Conf ;//OLD require('../ital8-conf.json');
    this.activeTheme = activeTheme;// nome del tema attivoQUESTA DEFINIZIONE SERVE A PERMETTERE DI IMPOSTARE UN TEMA ATTIVO DIVERSO DA QUELLO IMPOSTATO NEL FIEL DI CONFIGUAZIONE , AD ESEMPIO  PER I FILE DI ADMIN IL TEMA ATTIVO SARÀ SEMPRE QUELLO DI DEFULT 
    //this.#fnInPageMap = OpluginSys.fnInPage;
  }

  getThemePartPath( partName ){// partName Es footer.ejs header.ejs ecc
    //console.log(`${__dirname}/themes/${ital8Conf.activeTheme}/views/${partName}`);
    return `${__dirname}/../themes/${this.activeTheme}/views/${partName}`;
  }
  /* 
  questo metodo prenderà comeparamentro la parte della pagina chesu vuole generare
   Es: head, header, body, booter ecc
   e eseguirà le funzioni corrispondenti e le restituirà
  */

   //OLD 
 /*  getPagePart( pagePart, passData ){

    let stingToReturn = "";
    for( const [ nomePlugin, fnMap] of this.#fnInPageMap ){
      if( fnMap.has(pagePart) ){// se siste la parte richiesta Es se il plugin bootstrap ha richiesto di inserire qualcosa in 'head'
        stingToReturn += ` <!-- \n START ${nomePlugin} part --> \n` ;
        const fnToExc = fnMap.get(pagePart);
        stingToReturn += fnToExc(passData);// viene ottenuta la funzione che avrà come argomento (passData) e il cui valore sarà concatenato alla stringa
        stingToReturn += ` <!-- \n END ${nomePlugin} part --> \n ` ;
      }
    }

    return stingToReturn;
  } */
}

module.exports = themeSys;