/**
 * La porta di un server di test la sceglie il SISTEMA, non il dado.
 *
 * Prima i due file che avviano `node index.js` su una fixture facevano
 * `34000 + random(1500)` e `35000 + random(1500)`: una porta scelta alla cieca,
 * scritta nel config, senza che nessuno verificasse che fosse libera.
 *
 * Due difetti in uno. Il primo: quei range stanno DENTRO l'intervallo effimero
 * di Linux (tipicamente 32768-60999), cioè proprio quello da cui il kernel pesca
 * le porte delle connessioni in USCITA — su un runner CI che intanto parla con
 * npm, git e GitHub, la porta scelta può essere occupata da una socket che non
 * c'entra nulla con la suite. Il secondo: i due range si **sovrappongono** fra
 * 35000 e 35500, quindi i due file potevano pescare la stessa porta (la suite
 * gira seriale, ma un processo che tarda a chiudere basta).
 *
 * Misurato il 25/11/2026 sul job con copertura: « porta 35464 già in uso »,
 * avvio interrotto, un test rosso con i due job gemelli verdi. 35464 cade
 * proprio nella sovrapposizione.
 *
 * Chiedendola al kernel con `listen(0)` il problema si sposta: una porta
 * attualmente in ascolto non viene mai assegnata, quindi la finestra si riduce
 * ai microsecondi fra la nostra `close()` e la `listen()` del figlio — invece di
 * essere una lotteria contro occupanti ignoti. Per quella finestra c'è il
 * ritentativo, che i chiamanti innestano nel proprio `runBoot` usando
 * `PORT_BUSY`.
 *
 * La forma a prova di gara sarebbe passare al figlio la socket già in ascolto,
 * che `index.js` non sa ricevere: non si piega l'applicazione per il test.
 */

'use strict';

const net = require('net');

/** Una porta che il kernel garantisce non in ascolto al momento della risposta. */
function reservePort() {
  return new Promise((resolve, reject) => {
    const sonda = net.createServer();
    sonda.once('error', reject);
    sonda.listen(0, '127.0.0.1', () => {
      const { port } = sonda.address();
      sonda.close(() => resolve(port));
    });
  });
}

/**
 * Riconosce il box che il server stampa quando la porta risulta occupata al
 * bind. Ancorato alle due righe che quel box stampa sempre, non alla grafia
 * dell'intero riquadro.
 */
const PORT_BUSY = /porta non disponibile|porta \d+ già in uso/;

module.exports = { reservePort, PORT_BUSY };
