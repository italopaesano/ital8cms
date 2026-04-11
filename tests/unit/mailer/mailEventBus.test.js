/**
 * Unit tests for mailer/lib/mailEventBus.js
 */

'use strict';

const MailEventBus = require('../../../plugins/mailer/lib/mailEventBus');

// ══════════════════════════════════════════
// MailEventBus
// ══════════════════════════════════════════

describe('MailEventBus', () => {

  // ── Registrazione listener ──

  describe('on()', () => {
    test('registers a listener without error', () => {
      const bus = new MailEventBus();
      expect(() => bus.on(jest.fn())).not.toThrow();
    });

    test('throws if callback is not a function', () => {
      const bus = new MailEventBus();
      expect(() => bus.on('not a function')).toThrow();
      expect(() => bus.on(42)).toThrow();
      expect(() => bus.on(null)).toThrow();
      expect(() => bus.on(undefined)).toThrow();
    });

    test('registers multiple listeners', () => {
      const bus = new MailEventBus();
      bus.on(jest.fn());
      bus.on(jest.fn());
      bus.on(jest.fn());
      expect(bus.listenerCount()).toBe(3);
    });

    test('starts with zero listeners', () => {
      const bus = new MailEventBus();
      expect(bus.listenerCount()).toBe(0);
    });
  });

  // ── Emissione eventi ──

  describe('emit()', () => {
    test('calls all registered listeners', () => {
      const bus = new MailEventBus();
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      bus.on(cb1);
      bus.on(cb2);

      bus.emit('mailSent', { id: '123' });

      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    test('passes eventName and data to listener', () => {
      const bus = new MailEventBus();
      const cb = jest.fn();
      bus.on(cb);

      const data = { id: 'abc', to: ['user@example.com'], subject: 'Test' };
      bus.emit('mailQueued', data);

      expect(cb).toHaveBeenCalledWith('mailQueued', data);
    });

    test('does not call listeners when none registered', () => {
      const bus = new MailEventBus();
      // Should not throw
      expect(() => bus.emit('mailSent', {})).not.toThrow();
    });

    test('emits different event types correctly', () => {
      const bus = new MailEventBus();
      const events = [];
      bus.on((eventName, data) => events.push({ eventName, data }));

      bus.emit('mailQueued', { id: '1' });
      bus.emit('mailSent', { id: '2' });
      bus.emit('mailFailed', { id: '3' });
      bus.emit('mailDead', { id: '4' });

      expect(events).toHaveLength(4);
      expect(events[0].eventName).toBe('mailQueued');
      expect(events[1].eventName).toBe('mailSent');
      expect(events[2].eventName).toBe('mailFailed');
      expect(events[3].eventName).toBe('mailDead');
    });
  });

  // ── Isolamento errori nei listener ──

  describe('listener error isolation', () => {
    test('continues calling other listeners if one throws', () => {
      const bus = new MailEventBus();
      const cb1 = jest.fn(() => { throw new Error('Listener crash'); });
      const cb2 = jest.fn();
      bus.on(cb1);
      bus.on(cb2);

      // Suppress console.warn for this test
      const originalWarn = console.warn;
      console.warn = jest.fn();

      bus.emit('mailSent', {});

      console.warn = originalWarn;

      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    test('logs warning when listener throws', () => {
      const bus = new MailEventBus();
      bus.on(() => { throw new Error('Listener error'); });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      bus.emit('mailFailed', {});

      // Assert BEFORE mockRestore() — Jest 30 resets call history on restore
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    test('does not throw to caller when listener throws', () => {
      const bus = new MailEventBus();
      bus.on(() => { throw new Error('boom'); });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => bus.emit('mailDead', {})).not.toThrow();
      warnSpy.mockRestore();
    });
  });

  // ── listenerCount ──

  describe('listenerCount()', () => {
    test('returns 0 for new instance', () => {
      const bus = new MailEventBus();
      expect(bus.listenerCount()).toBe(0);
    });

    test('returns correct count after registrations', () => {
      const bus = new MailEventBus();
      bus.on(jest.fn());
      expect(bus.listenerCount()).toBe(1);
      bus.on(jest.fn());
      expect(bus.listenerCount()).toBe(2);
    });
  });
});
