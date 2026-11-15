/** Controllable clock so time-dependent logic can be asserted exactly. */

export interface TestClock {
  now: () => Date;
  set: (iso: string | Date) => void;
  advance: (ms: number) => void;
  advanceMinutes: (minutes: number) => void;
  advanceHours: (hours: number) => void;
  advanceDays: (days: number) => void;
}

export function createTestClock(start: string | Date = '2026-11-13T09:00:00.000Z'): TestClock {
  let current = new Date(start);

  return {
    now: () => new Date(current),
    set: (value) => {
      current = new Date(value);
    },
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
    advanceMinutes: (minutes) => {
      current = new Date(current.getTime() + minutes * 60_000);
    },
    advanceHours: (hours) => {
      current = new Date(current.getTime() + hours * 3_600_000);
    },
    advanceDays: (days) => {
      current = new Date(current.getTime() + days * 86_400_000);
    },
  };
}
