import { beforeEach, describe, expect, it } from 'vitest';
import { useReplayStore } from './useReplayStore';

describe('useReplayStore — furthest revealed candle', () => {
  beforeEach(() => useReplayStore.getState().resetReplay());

  it('remembers the furthest candle when stepping back', () => {
    const s = useReplayStore.getState();
    s.setStartIndex(10, 100);
    s.stepForward(100);
    s.stepForward(100);
    s.stepBackward();
    const { currentIndex, furthestIndex } = useReplayStore.getState();
    expect(currentIndex).toBe(11);
    expect(furthestIndex).toBe(12);
  });

  it('starts over from a new starting point', () => {
    const s = useReplayStore.getState();
    s.setStartIndex(10, 100);
    s.setCurrentIndex(50, 100);
    s.setStartIndex(5, 100);
    expect(useReplayStore.getState().furthestIndex).toBe(5);
  });
});
