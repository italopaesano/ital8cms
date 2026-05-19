const fs = require('fs');

const ENABLE_ADMIN_RE = /^(\s*"enableAdmin"\s*:\s*)(true|false)(\s*,?\s*)(\/\/[^\n]*)?$/m;

function readEnableAdmin(configPath) {
  const text = fs.readFileSync(configPath, 'utf8');
  const match = text.match(ENABLE_ADMIN_RE);
  if (!match) {
    const err = new Error(`enableAdmin non trovato in ${configPath} (formato config non standard?)`);
    err.code = 'ENABLE_ADMIN_NOT_FOUND';
    throw err;
  }
  return match[2] === 'true';
}

function writeEnableAdmin(configPath, value) {
  if (typeof value !== 'boolean') {
    throw new TypeError(`value must be boolean, got ${typeof value}`);
  }

  const text = fs.readFileSync(configPath, 'utf8');
  const match = text.match(ENABLE_ADMIN_RE);
  if (!match) {
    const err = new Error(
      `enableAdmin non trovato in ${configPath} (formato config non standard?). ` +
      `Modifica il valore a mano e riavvia il server.`
    );
    err.code = 'ENABLE_ADMIN_NOT_FOUND';
    throw err;
  }

  const currentValue = match[2] === 'true';
  if (currentValue === value) {
    return { changed: false, previous: currentValue, current: value };
  }

  const replaced = text.replace(ENABLE_ADMIN_RE, (_full, prefix, _oldVal, suffix, comment) => {
    return `${prefix}${value}${suffix}${comment || ''}`;
  });

  const tempPath = configPath + '.cli-tmp';
  fs.writeFileSync(tempPath, replaced, 'utf8');
  fs.renameSync(tempPath, configPath);

  return { changed: true, previous: currentValue, current: value };
}

module.exports = {
  readEnableAdmin,
  writeEnableAdmin,
  ENABLE_ADMIN_RE,
};
