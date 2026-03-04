/**
 * wwwFilesystem.test.js
 *
 * Test di integrazione per verificare che il filesystem nella directory www/
 * sia compatibile con koa-classic-server.
 *
 * Su NixOS con buildFHSEnv, readdir può restituire DT_UNKNOWN (tipo 0)
 * o symlink verso il Nix store. koa-classic-server v2.6.1+ gestisce
 * entrambi i casi con un fallback a stat(), ma questo test verifica
 * che il fallback funzioni effettivamente nell'ambiente corrente.
 *
 * Diagnosi i seguenti test e2e che possono fallire su NixOS:
 *   - homepage.spec.js: "should load homepage successfully" (title "Index of /")
 *   - globalPrefix.spec.js: "public pages index.ejs is accessible" (404)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const wwwDir = path.join(__dirname, '..', '..', 'www');

/**
 * Replica esatta di isFileOrSymlinkToFile da koa-classic-server v2.6.1
 * Restituisce true se il dirent è un file regolare o un symlink/DT_UNKNOWN
 * che punta a un file regolare.
 */
async function isFileOrSymlinkToFile(dirent, dirPath) {
  if (dirent.isFile()) return true;
  if (dirent.isSymbolicLink()) {
    try {
      const realStat = await fs.promises.stat(path.join(dirPath, dirent.name));
      return realStat.isFile();
    } catch {
      return false;
    }
  }
  // DT_UNKNOWN fallback (overlayfs, NFS, FUSE, NixOS buildFHSEnv, ecryptfs)
  if (!dirent.isDirectory() && !dirent.isBlockDevice() && !dirent.isCharacterDevice() && !dirent.isFIFO() && !dirent.isSocket()) {
    try {
      const realStat = await fs.promises.stat(path.join(dirPath, dirent.name));
      return realStat.isFile();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Restituisce il numero di tipo raw dal dirent (campo Symbol interno)
 * 0=DT_UNKNOWN, 1=DT_REG, 2=DT_DIR, 3=DT_LNK
 */
function getDirentTypeNumber(dirent) {
  const symbols = Object.getOwnPropertySymbols(dirent);
  if (symbols.length > 0) {
    const val = dirent[symbols[0]];
    return typeof val === 'number' ? val : null;
  }
  return null;
}

describe('www/ Filesystem Compatibility', () => {

  describe('Prerequisiti: directory e file index', () => {
    test('www/ directory esiste', async () => {
      const stat = await fs.promises.stat(wwwDir);
      expect(stat.isDirectory()).toBe(true);
    });

    test('www/index.ejs esiste (stat — segue symlink)', async () => {
      const indexPath = path.join(wwwDir, 'index.ejs');
      const stat = await fs.promises.stat(indexPath);
      expect(stat.isFile()).toBe(true);
    });

    test('www/index.ejs leggibile (access R_OK)', async () => {
      const indexPath = path.join(wwwDir, 'index.ejs');
      await expect(fs.promises.access(indexPath, fs.constants.R_OK)).resolves.toBeUndefined();
    });

    test('www/index.ejs non è vuoto', async () => {
      const indexPath = path.join(wwwDir, 'index.ejs');
      const stat = await fs.promises.stat(indexPath);
      expect(stat.size).toBeGreaterThan(0);
    });
  });

  describe('readdir con dirent types', () => {
    let entries;

    beforeAll(async () => {
      entries = await fs.promises.readdir(wwwDir, { withFileTypes: true });
    });

    test('readdir restituisce entries', () => {
      expect(entries.length).toBeGreaterThan(0);
    });

    test('readdir contiene "index.ejs"', () => {
      const names = entries.map(e => e.name);
      expect(names).toContain('index.ejs');
    });

    test('index.ejs dirent ha tipo valido (0, 1, o 3)', () => {
      const indexEntry = entries.find(e => e.name === 'index.ejs');
      expect(indexEntry).toBeDefined();

      const typeNum = getDirentTypeNumber(indexEntry);
      // 0=DT_UNKNOWN, 1=DT_REG (file), 3=DT_LNK (symlink)
      // Tutti gestiti da koa-classic-server v2.6.1
      expect([0, 1, 3]).toContain(typeNum);

      if (typeNum === 0) {
        console.log('[wwwFilesystem] index.ejs ha tipo DT_UNKNOWN (0) — filesystem overlay/FUSE/NixOS');
      } else if (typeNum === 3) {
        console.log('[wwwFilesystem] index.ejs ha tipo DT_LNK (3) — è un symlink');
      } else {
        console.log('[wwwFilesystem] index.ejs ha tipo DT_REG (1) — file regolare');
      }
    });

    test('nessun entry ha tipo non riconosciuto (>3 escluso 0-3)', () => {
      for (const entry of entries) {
        const typeNum = getDirentTypeNumber(entry);
        if (typeNum !== null) {
          expect([0, 1, 2, 3]).toContain(typeNum);
        }
      }
    });
  });

  describe('isFileOrSymlinkToFile (logica koa-classic-server v2.6.1)', () => {
    test('index.ejs riconosciuto come file', async () => {
      const entries = await fs.promises.readdir(wwwDir, { withFileTypes: true });
      const indexEntry = entries.find(e => e.name === 'index.ejs');
      expect(indexEntry).toBeDefined();

      const result = await isFileOrSymlinkToFile(indexEntry, wwwDir);
      expect(result).toBe(true);
    });

    test('tutti i file .ejs in www/ riconosciuti come file', async () => {
      const entries = await fs.promises.readdir(wwwDir, { withFileTypes: true });
      const ejsEntries = entries.filter(e => e.name.endsWith('.ejs'));

      for (const entry of ejsEntries) {
        const result = await isFileOrSymlinkToFile(entry, wwwDir);
        expect(result).toBe(true);
      }
    });

    test('directories NON riconosciute come file', async () => {
      const entries = await fs.promises.readdir(wwwDir, { withFileTypes: true });

      for (const entry of entries) {
        const typeNum = getDirentTypeNumber(entry);
        // Se è una directory (type 2), isFileOrSymlinkToFile deve restituire false
        if (typeNum === 2 || entry.isDirectory()) {
          const result = await isFileOrSymlinkToFile(entry, wwwDir);
          expect(result).toBe(false);
        }
      }
    });
  });

  describe('Simulazione findIndexFile', () => {
    test('findIndexFile trova index.ejs con pattern stringa esatta', async () => {
      const entries = await fs.promises.readdir(wwwDir, { withFileTypes: true });

      // Replica la logica di findIndexFile da koa-classic-server v2.6.1
      const fileCheckResults = await Promise.all(
        entries.map(async dirent => ({
          name: dirent.name,
          isFile: await isFileOrSymlinkToFile(dirent, wwwDir)
        }))
      );
      const fileNames = fileCheckResults
        .filter(entry => entry.isFile)
        .map(entry => entry.name);

      // Pattern: ['index.ejs'] — matching esatto (come configurato in index.js)
      expect(fileNames).toContain('index.ejs');

      // Verifica stat dopo il match (come fa findIndexFile)
      const indexPath = path.join(wwwDir, 'index.ejs');
      const fileStat = await fs.promises.stat(indexPath);
      expect(fileStat.isFile()).toBe(true);
    });
  });

  describe('Path resolution (come koa-classic-server)', () => {
    test('normalizedRootDir è assoluto e valido', () => {
      const normalizedRootDir = path.resolve(wwwDir);
      expect(path.isAbsolute(normalizedRootDir)).toBe(true);
    });

    test('path.join(rootDir, "/index.ejs") punta al file corretto', async () => {
      const normalizedRootDir = path.resolve(wwwDir);
      const fullPath = path.join(normalizedRootDir, '/index.ejs');

      expect(fullPath.startsWith(normalizedRootDir)).toBe(true);

      const stat = await fs.promises.stat(fullPath);
      expect(stat.isFile()).toBe(true);
    });

    test('path risolto corrisponde a www/index.ejs', () => {
      const normalizedRootDir = path.resolve(wwwDir);
      const fullPath = path.join(normalizedRootDir, '/index.ejs');
      const expected = path.join(wwwDir, 'index.ejs');

      expect(path.resolve(fullPath)).toBe(path.resolve(expected));
    });
  });

  describe('Symlink analysis (se applicabile)', () => {
    test('se index.ejs è un symlink, il target è accessibile', async () => {
      const indexPath = path.join(wwwDir, 'index.ejs');
      const lstat = await fs.promises.lstat(indexPath);

      if (lstat.isSymbolicLink()) {
        const target = await fs.promises.readlink(indexPath);
        console.log(`[wwwFilesystem] index.ejs → symlink target: ${target}`);

        // Il target deve essere accessibile via stat (che segue i symlink)
        const stat = await fs.promises.stat(indexPath);
        expect(stat.isFile()).toBe(true);
      } else {
        // Non è un symlink — test passa automaticamente
        console.log('[wwwFilesystem] index.ejs non è un symlink — test non applicabile');
      }
    });
  });

  describe('Diagnostica informativa (non-blocking)', () => {
    test('riepilogo tipi dirent in www/', async () => {
      const entries = await fs.promises.readdir(wwwDir, { withFileTypes: true });
      const typeCount = { 0: 0, 1: 0, 2: 0, 3: 0 };

      for (const entry of entries) {
        const typeNum = getDirentTypeNumber(entry);
        if (typeNum !== null && typeNum in typeCount) {
          typeCount[typeNum]++;
        }
      }

      console.log(`[wwwFilesystem] Distribuzione tipi dirent:
  DT_UNKNOWN (0): ${typeCount[0]}
  DT_REG     (1): ${typeCount[1]}
  DT_DIR     (2): ${typeCount[2]}
  DT_LNK     (3): ${typeCount[3]}
  Totale entries:  ${entries.length}`);

      // Questo test è sempre verde — serve solo per output diagnostico
      expect(entries.length).toBeGreaterThan(0);
    });
  });
});
