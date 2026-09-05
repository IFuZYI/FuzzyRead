import { describe, expect, it } from 'vitest';
import { AsyncTaskQueue } from '../src/utils/asyncQueue';

describe('title translation output and queue behavior', () => {
  it('limits concurrent tasks', async () => {
    const queue = new AsyncTaskQueue(2);
    let running = 0;
    let peak = 0;
    await Promise.all(Array.from({ length: 8 }, (_, index) => queue.add(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise(resolve => setTimeout(resolve, 2));
      running -= 1;
      return index;
    })));
    expect(peak).toBeLessThanOrEqual(2);
  });
});
