import { describe, it, expect, vi } from 'vitest';
import { logger, onEvent } from './logger.js';

describe('logger.onEvent subscription', () => {
  it('calls a registered listener when logger.event fires', () => {
    const received: unknown[] = [];
    const unsub = onEvent((e) => received.push(e));

    logger.event({ stage: 'test', status: 'ok', value: 42 });

    unsub();

    expect(received).toHaveLength(1);
    const e = received[0] as Record<string, unknown>;
    expect(e['stage']).toBe('test');
    expect(e['status']).toBe('ok');
    expect(e['value']).toBe(42);
  });

  it('unsubscribed listener is not called after unsub()', () => {
    const received: unknown[] = [];
    const unsub = onEvent((e) => received.push(e));
    unsub();

    logger.event({ stage: 'after', status: 'gone' });

    expect(received).toHaveLength(0);
  });

  it('multiple listeners all receive the event', () => {
    const a: unknown[] = [];
    const b: unknown[] = [];
    const u1 = onEvent((e) => a.push(e));
    const u2 = onEvent((e) => b.push(e));

    logger.event({ stage: 'multi', status: 'yes' });

    u1();
    u2();

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});
