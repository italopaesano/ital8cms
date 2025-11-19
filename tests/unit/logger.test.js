/**
 * Unit Tests per core/logger.js
 */

const path = require('path');

describe('Logger Module', () => {
  let logger;
  let consoleSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    // Reset del modulo per ogni test
    jest.resetModules();

    // Spy sulle console
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('Log Levels', () => {
    test('logger.info scrive su console.log', () => {
      process.env.LOG_LEVEL = 'INFO';
      logger = require('../../core/logger');

      logger.info('test', 'Messaggio di test');

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0][0]).toContain('[INFO]');
      expect(consoleSpy.mock.calls[0][0]).toContain('[test]');
      expect(consoleSpy.mock.calls[0][0]).toContain('Messaggio di test');
    });

    test('logger.error scrive su console.error', () => {
      process.env.LOG_LEVEL = 'INFO';
      logger = require('../../core/logger');

      logger.error('test', 'Errore di test');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('[ERROR]');
    });

    test('logger.debug non scrive se LOG_LEVEL=INFO', () => {
      process.env.LOG_LEVEL = 'INFO';
      logger = require('../../core/logger');

      logger.debug('test', 'Debug message');

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    test('logger.debug scrive se LOG_LEVEL=DEBUG', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      logger = require('../../core/logger');

      logger.debug('test', 'Debug message');

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0][0]).toContain('[DEBUG]');
    });

    test('logger.warn scrive warning', () => {
      process.env.LOG_LEVEL = 'INFO';
      logger = require('../../core/logger');

      logger.warn('test', 'Warning message');

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0][0]).toContain('[WARN]');
    });
  });

  describe('Log Filtering', () => {
    test('LOG_LEVEL=ERROR filtra INFO e WARN', () => {
      process.env.LOG_LEVEL = 'ERROR';
      logger = require('../../core/logger');

      logger.info('test', 'Info');
      logger.warn('test', 'Warn');

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    test('LOG_LEVEL=WARN filtra INFO e DEBUG', () => {
      process.env.LOG_LEVEL = 'WARN';
      logger = require('../../core/logger');

      logger.info('test', 'Info');
      logger.debug('test', 'Debug');

      expect(consoleSpy).not.toHaveBeenCalled();

      logger.warn('test', 'Warn');
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('Utility Functions', () => {
    test('getLevel ritorna il livello corrente', () => {
      process.env.LOG_LEVEL = 'WARN';
      logger = require('../../core/logger');

      expect(logger.getLevel()).toBe('WARN');
    });

    test('isLevelEnabled verifica se livello attivo', () => {
      process.env.LOG_LEVEL = 'INFO';
      logger = require('../../core/logger');

      expect(logger.isLevelEnabled('DEBUG')).toBe(false);
      expect(logger.isLevelEnabled('INFO')).toBe(true);
      expect(logger.isLevelEnabled('WARN')).toBe(true);
      expect(logger.isLevelEnabled('ERROR')).toBe(true);
    });
  });

  describe('Output Format', () => {
    test('include timestamp ISO', () => {
      process.env.LOG_LEVEL = 'INFO';
      logger = require('../../core/logger');

      logger.info('test', 'Message');

      const output = consoleSpy.mock.calls[0][0];
      // Verifica formato timestamp ISO
      expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('include prefisso modulo', () => {
      process.env.LOG_LEVEL = 'INFO';
      logger = require('../../core/logger');

      logger.info('myModule', 'Message');

      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('[myModule]');
    });
  });

  describe('Error Handling', () => {
    test('logga stack trace per oggetti Error', () => {
      process.env.LOG_LEVEL = 'INFO';
      logger = require('../../core/logger');

      const error = new Error('Test error');
      logger.error('test', 'Errore', error);

      // Prima chiamata: messaggio, seconda: stack
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    });

    test('logga dati extra per non-Error', () => {
      process.env.LOG_LEVEL = 'INFO';
      logger = require('../../core/logger');

      const data = { foo: 'bar' };
      logger.error('test', 'Errore', data);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    });
  });
});
