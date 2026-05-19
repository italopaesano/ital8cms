const { detectSupervisor, SUPERVISOR_ENV_VARS } = require('../../../core/cliBridge/respawn');

describe('detectSupervisor', () => {
  test('returns null with an empty env', () => {
    expect(detectSupervisor({})).toBeNull();
  });

  test('returns "PM2_HOME" when PM2_HOME is set', () => {
    expect(detectSupervisor({ PM2_HOME: '/var/pm2' })).toBe('PM2_HOME');
  });

  test('returns "INVOCATION_ID" when systemd has launched the process', () => {
    expect(detectSupervisor({ INVOCATION_ID: 'abc' })).toBe('INVOCATION_ID');
  });

  test('returns "SUPERVISORD_ENABLED" when supervisord is in charge', () => {
    expect(detectSupervisor({ SUPERVISORD_ENABLED: '1' })).toBe('SUPERVISORD_ENABLED');
  });

  test('ignores unrelated env keys', () => {
    expect(detectSupervisor({ PATH: '/bin', HOME: '/home' })).toBeNull();
  });

  test('empty string values are treated as not set', () => {
    expect(detectSupervisor({ PM2_HOME: '' })).toBeNull();
  });

  test('first match wins (PM2 over systemd if both set)', () => {
    expect(detectSupervisor({
      PM2_HOME: '/var/pm2',
      INVOCATION_ID: 'abc',
    })).toBe('PM2_HOME');
  });

  test('SUPERVISOR_ENV_VARS lists exactly the three known supervisors', () => {
    expect(SUPERVISOR_ENV_VARS.sort()).toEqual(['INVOCATION_ID', 'PM2_HOME', 'SUPERVISORD_ENABLED']);
  });
});
