const { spawn } = require('child_process');

const SUPERVISOR_ENV_VARS = ['PM2_HOME', 'INVOCATION_ID', 'SUPERVISORD_ENABLED'];

function detectSupervisor(env = process.env) {
  for (const key of SUPERVISOR_ENV_VARS) {
    if (env[key]) return key;
  }
  return null;
}

function selfRespawn(opts = {}) {
  const delayMs = opts.delayMs ?? 100;

  const child = spawn(process.execPath, process.argv.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: 'inherit',
  });

  child.unref();

  setTimeout(() => process.exit(0), delayMs);
}

module.exports = {
  selfRespawn,
  detectSupervisor,
  SUPERVISOR_ENV_VARS,
};
