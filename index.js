const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');
const FTP = require('ftp');
require('dotenv').config();

const xmlPath = path.join(__dirname, 'tournament.xml');
const htmlPath = path.join(__dirname, 'output.html');

const parser = new xml2js.Parser({ explicitArray: false });

function loadXML(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) reject(err);
      parser.parseString(data, (err, result) => {
        if (err) reject(err);
        resolve(result);
      });
    });
  });
}

function getPlayerNameMap(players) {
  const map = {};
  players.forEach(p => {
    const id = p.$.userid;
    map[id] = `${p.firstname} ${p.lastname}`;
  });
  return map;
}

function getLatestRound(pods) {
  const pod = pods.pod;
  const rounds = Array.isArray(pod.rounds.round)
    ? pod.rounds.round
    : [pod.rounds.round];
  return rounds.sort((a, b) => +b.$.number - +a.$.number)[0];
}

function generateHTML(tournamentName, matchList, playerMap) {
  const rows = matchList.map(match => {
    const table = match.tablenumber;
    const p1 = playerMap[match.player1.$.userid] || "???";
    const p2 = playerMap[match.player2.$.userid] || "???";
    return `<tr><td>${table}</td><td>${p1}</td><td>${p2}</td></tr>`;
  });

  return `
  <!DOCTYPE html>
  <html lang="pl">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${tournamentName}</title>
    <style>
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        margin: 0;
        padding: 0;
        background: #f9f9f9;
        color: #333;
      }
      header {
        background: #004466;
        color: white;
        padding: 20px;
        text-align: center;
      }
      h1 {
        font-size: 1.8em;
        margin: 0;
      }
      main {
        padding: 20px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
      }
      th, td {
        border: 1px solid #ddd;
        padding: 12px 8px;
        text-align: left;
        font-size: 1em;
      }
      th {
        background: #eeeeee;
      }
      tr:nth-child(even) {
        background: #fafafa;
      }
      @media (max-width: 600px) {
        table, thead, tbody, th, td, tr {
          display: block;
        }
        thead {
          display: none;
        }
        tr {
          margin-bottom: 15px;
          background: white;
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 8px;
        }
        td {
          padding: 8px 10px;
          text-align: right;
          position: relative;
        }
        td::before {
          content: attr(data-label);
          position: absolute;
          left: 10px;
          top: 8px;
          font-weight: bold;
          text-align: left;
        }
      }
    </style>
  </head>
  <body>
    <header><h1>${tournamentName}</h1></header>
    <main>
      <table>
        <thead>
          <tr><th>Stół</th><th>Gracz 1</th><th>Gracz 2</th></tr>
        </thead>
        <tbody>
          ${rows.map(row => {
            const [table, p1, p2] = row.match(/<td>(.*?)<\/td>/g).map(td => td.replace(/<\/?td>/g, ''));
            return `
              <tr>
                <td data-label="Stół">${table}</td>
                <td data-label="Gracz 1">${p1}</td>
                <td data-label="Gracz 2">${p2}</td>
              </tr>`;
          }).join('\n')}
        </tbody>
      </table>
    </main>
  </body>
  </html>
  `;
}


function uploadViaFTP(filePath, remoteFileName) {
  return new Promise((resolve, reject) => {
    const client = new FTP();
    client.on('ready', () => {
      client.put(filePath, path.join(process.env.FTP_DEST, remoteFileName), err => {
        if (err) reject(err);
        else {
          console.log('✔ HTML wysłany na FTP');
          client.end();
          resolve();
        }
      });
    });
    client.connect({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
    });
  });
}

function generateEmptyHTML() {
  return `
  <!DOCTYPE html>
  <html lang="pl">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Oczekiwanie na dane</title>
    <style>
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        margin: 0;
        background-color: #f2f2f2;
        color: #333;
        text-align: center;
        padding: 20px;
      }
      .message {
        background: white;
        padding: 30px 20px;
        border-radius: 10px;
        box-shadow: 0 0 10px rgba(0,0,0,0.1);
      }
      h1 {
        font-size: 1.6em;
      }
    </style>
  </head>
  <body>
    <div class="message">
      <h1>Oczekiwanie na dane turniejowe...</h1>
      <p>Plik XML jest pusty lub jeszcze nie został wygenerowany.</p>
    </div>
  </body>
  </html>
  `;
}

(async () => {
  try {
    const xmlRaw = fs.readFileSync(xmlPath, 'utf8').trim();

    // Jeśli plik jest pusty
    if (!xmlRaw || xmlRaw.length < 10) {
      console.log("⚠ Brak danych w pliku XML – generuję pustą stronę.");
      const emptyHTML = generateEmptyHTML();
      fs.writeFileSync(htmlPath, emptyHTML, 'utf8');
      await uploadViaFTP(htmlPath, 'index.html');
      return;
    }

    const data = await parser.parseStringPromise(xmlRaw);

    if (!data?.tournament?.players?.player || !data.tournament.pods?.pod) {
      console.log("⚠ Brak wymaganych danych w XML – generuję pustą stronę.");
      const emptyHTML = generateEmptyHTML();
      fs.writeFileSync(htmlPath, emptyHTML, 'utf8');
      await uploadViaFTP(htmlPath, 'index.html');
      return;
    }

    const tournamentName = data.tournament.data.name;
    const players = Array.isArray(data.tournament.players.player)
      ? data.tournament.players.player
      : [data.tournament.players.player];

    const playerMap = getPlayerNameMap(players);
    const pods = data.tournament.pods;
    const round = getLatestRound(pods);
    const matches = Array.isArray(round.matches.match)
      ? round.matches.match
      : [round.matches.match];

    const html = generateHTML(tournamentName, matches, playerMap);
    fs.writeFileSync(htmlPath, html, 'utf8');

    await uploadViaFTP(htmlPath, 'index.html');
  } catch (err) {
    console.error('❌ Błąd:', err);
  }
})();

