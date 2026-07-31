/**
 * TDD Red Phase: frequency-support feature
 *
 * These tests MUST FAIL until the implementation is complete.
 * See: openspec/changes/frequency-support/specs/frequency-support/spec.md
 * See: _longrun/2026-03-11_frequency-support/instruction.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isTargetDay,
  shouldShowToday,
  getHabitsWithStats,
  calculateStreak,
  getCompletionRate,
} from '@/lib/habits';
import type { HabitCompletion, Habit } from '@/types/habit';

// ============================================================
// Helpers (same patterns as habits.test.ts)
// ============================================================

function makeCompletionTyped(
  habitId: string,
  date: string,
  status: HabitCompletion['status'] = 'completed'
): HabitCompletion {
  return {
    habitId,
    date,
    completedAt: `${date}T00:00:00.000Z`,
    status,
  };
}

/**
 * makeHabit — uses the new frequency values from the spec.
 * Note: TypeScript will emit type errors here until src/types/habit.ts is updated.
 * That is expected (Red phase).
 */
function makeHabit(overrides: Partial<Habit> & { id: string }): Habit {
  return {
    name: 'Test Habit',
    icon: 'target',
    frequency: 'everyday',
    type: 'positive',
    createdAt: '2026-01-01',
    archived: false,
    evidences: [],
    sortOrder: 0,
    status: 'active',
    ...overrides,
  };
}

function getDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns a Date object for a day N weeks ago at the given weekday.
 * weeksAgo=0 → this week, weeksAgo=1 → last week, etc.
 * dayOfWeek: 1=Mon, ..., 7=Sun (ISO 8601: week starts Monday)
 */
function getDateForISOWeek(weeksAgo: number, isoDayOfWeek: number): Date {
  // Find Monday of the current ISO week
  const today = new Date();
  const todayDow = today.getDay(); // 0=Sun
  // ISO Monday index: convert Sun(0)->7, Mon(1)->1 ... Sat(6)->6
  const isoToday = todayDow === 0 ? 7 : todayDow;
  const monday = new Date(today);
  monday.setDate(today.getDate() - (isoToday - 1) - weeksAgo * 7);
  // Advance to requested ISO day (1=Mon, 2=Tue, ..., 7=Sun)
  const result = new Date(monday);
  result.setDate(monday.getDate() + (isoDayOfWeek - 1));
  return result;
}

// ============================================================
// REQ-FS-04: isTargetDay
// ============================================================

describe('isTargetDay', () => {
  // SCENARIO-FS-01: everyday is target on every day
  describe('everyday → always true', () => {
    it('should return true for everyday habit on Saturday', () => {
      // 2026-03-14 is a Saturday
      const habit = makeHabit({ id: 'h1', frequency: 'everyday' as Habit['frequency'] });
      expect(isTargetDay(habit, new Date('2026-03-14'))).toBe(true);
    });

    it('should return true for everyday habit on Monday', () => {
      const habit = makeHabit({ id: 'h1', frequency: 'everyday' as Habit['frequency'] });
      expect(isTargetDay(habit, new Date('2026-03-16'))).toBe(true);
    });

    it('should return true for everyday habit on Sunday', () => {
      const habit = makeHabit({ id: 'h1', frequency: 'everyday' as Habit['frequency'] });
      expect(isTargetDay(habit, new Date('2026-03-15'))).toBe(true);
    });
  });

  // SCENARIO-FS-02: weekday → Mon–Fri true, Sat–Sun false
  describe('weekday → true Mon-Fri, false Sat-Sun', () => {
    it('should return false for weekday habit on Saturday (2026-03-14)', () => {
      const habit = makeHabit({ id: 'h1', frequency: 'weekday' as Habit['frequency'] });
      expect(isTargetDay(habit, new Date('2026-03-14'))).toBe(false);
    });

    it('should return false for weekday habit on Sunday (2026-03-15)', () => {
      const habit = makeHabit({ id: 'h1', frequency: 'weekday' as Habit['frequency'] });
      expect(isTargetDay(habit, new Date('2026-03-15'))).toBe(false);
    });

    it('should return true for weekday habit on Monday (2026-03-16)', () => {
      const habit = makeHabit({ id: 'h1', frequency: 'weekday' as Habit['frequency'] });
      expect(isTargetDay(habit, new Date('2026-03-16'))).toBe(true);
    });

    it('should return true for weekday habit on Wednesday (2026-03-18)', () => {
      const habit = makeHabit({ id: 'h1', frequency: 'weekday' as Habit['frequency'] });
      expect(isTargetDay(habit, new Date('2026-03-18'))).toBe(true);
    });

    it('should return true for weekday habit on Friday (2026-03-20)', () => {
      const habit = makeHabit({ id: 'h1', frequency: 'weekday' as Habit['frequency'] });
      expect(isTargetDay(habit, new Date('2026-03-20'))).toBe(true);
    });
  });

  // SCENARIO-FS-03: custom [1,3,5] → Mon/Wed/Fri true, others false
  describe('custom [1,3,5] → true Mon/Wed/Fri, false others', () => {
    it('should return true for custom [1,3,5] habit on Monday (2026-03-16)', () => {
      const habit = makeHabit({
        id: 'h1',
        frequency: 'custom' as Habit['frequency'],
        customDays: [1, 3, 5],
      });
      expect(isTargetDay(habit, new Date('2026-03-16'))).toBe(true);
    });

    it('should return false for custom [1,3,5] habit on Tuesday (2026-03-17)', () => {
      const habit = makeHabit({
        id: 'h1',
        frequency: 'custom' as Habit['frequency'],
        customDays: [1, 3, 5],
      });
      expect(isTargetDay(habit, new Date('2026-03-17'))).toBe(false);
    });

    it('should return true for custom [1,3,5] habit on Wednesday (2026-03-18)', () => {
      const habit = makeHabit({
        id: 'h1',
        frequency: 'custom' as Habit['frequency'],
        customDays: [1, 3, 5],
      });
      expect(isTargetDay(habit, new Date('2026-03-18'))).toBe(true);
    });

    it('should return false for custom [1,3,5] habit on Thursday (2026-03-19)', () => {
      const habit = makeHabit({
        id: 'h1',
        frequency: 'custom' as Habit['frequency'],
        customDays: [1, 3, 5],
      });
      expect(isTargetDay(habit, new Date('2026-03-19'))).toBe(false);
    });

    it('should return true for custom [1,3,5] habit on Friday (2026-03-20)', () => {
      const habit = makeHabit({
        id: 'h1',
        frequency: 'custom' as Habit['frequency'],
        customDays: [1, 3, 5],
      });
      expect(isTargetDay(habit, new Date('2026-03-20'))).toBe(true);
    });

    it('should return false for custom [1,3,5] habit on Saturday (2026-03-14)', () => {
      const habit = makeHabit({
        id: 'h1',
        frequency: 'custom' as Habit['frequency'],
        customDays: [1, 3, 5],
      });
      expect(isTargetDay(habit, new Date('2026-03-14'))).toBe(false);
    });

    it('should return false when customDays is empty', () => {
      const habit = makeHabit({
        id: 'h1',
        frequency: 'custom' as Habit['frequency'],
        customDays: [],
      });
      expect(isTargetDay(habit, new Date('2026-03-16'))).toBe(false);
    });
  });

  // SCENARIO-FS-04: weekly → always true (any day counts)
  describe('weekly → always true', () => {
    it('should return true for weekly habit on Saturday (2026-03-14)', () => {
      const habit = makeHabit({
        id: 'h1',
        frequency: 'weekly' as Habit['frequency'],
        weeklyTarget: 3,
      });
      expect(isTargetDay(habit, new Date('2026-03-14'))).toBe(true);
    });

    it('should return true for weekly habit on Monday (2026-03-16)', () => {
      const habit = makeHabit({
        id: 'h1',
        frequency: 'weekly' as Habit['frequency'],
        weeklyTarget: 1,
      });
      expect(isTargetDay(habit, new Date('2026-03-16'))).toBe(true);
    });
  });
});

// ============================================================
// REQ-FS-05: shouldShowToday (simplified)
// ============================================================

describe('shouldShowToday', () => {
  // SCENARIO-FS-05: non-archived → always true regardless of frequency
  it('should return true for non-archived everyday habit', () => {
    const habit = makeHabit({ id: 'h1', frequency: 'everyday' as Habit['frequency'], archived: false });
    expect(shouldShowToday(habit)).toBe(true);
  });

  it('should return true for non-archived weekday habit (regardless of current day)', () => {
    const habit = makeHabit({ id: 'h1', frequency: 'weekday' as Habit['frequency'], archived: false });
    // Should always be true regardless of today's actual weekday
    expect(shouldShowToday(habit)).toBe(true);
  });

  it('should return true for non-archived custom habit (regardless of current day)', () => {
    const habit = makeHabit({
      id: 'h1',
      frequency: 'custom' as Habit['frequency'],
      customDays: [1], // Monday only
      archived: false,
    });
    // Should always be true regardless of today's actual weekday
    expect(shouldShowToday(habit)).toBe(true);
  });

  it('should return true for non-archived weekly habit', () => {
    const habit = makeHabit({
      id: 'h1',
      frequency: 'weekly' as Habit['frequency'],
      weeklyTarget: 2,
      archived: false,
    });
    expect(shouldShowToday(habit)).toBe(true);
  });

  // SCENARIO-FS-06: archived → always false
  it('should return false for archived everyday habit', () => {
    const habit = makeHabit({ id: 'h1', frequency: 'everyday' as Habit['frequency'], archived: true });
    expect(shouldShowToday(habit)).toBe(false);
  });

  it('should return false for archived weekday habit', () => {
    const habit = makeHabit({ id: 'h1', frequency: 'weekday' as Habit['frequency'], archived: true });
    expect(shouldShowToday(habit)).toBe(false);
  });
});

// ============================================================
// REQ-FS-06: Auto-skip in getHabitsWithStats
// ============================================================

describe('getHabitsWithStats - auto-skip for non-target days', () => {
  // We mock "today" to a Saturday (2026-03-14) so we can test weekday auto-skip deterministically.
  // Note: vi.useFakeTimers mocks Date, so getTodayString() and isTargetDay() will see Saturday.

  beforeEach(() => {
    // 2026-03-14 is a Saturday
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-14T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // SCENARIO-FS-07: weekday habit on Saturday, no completion record → auto-skip
  it('should set skippedToday=true for weekday habit on Saturday with no completion record', () => {
    const today = '2026-03-14'; // Saturday
    const habit = makeHabit({ id: 'h1', frequency: 'weekday' as Habit['frequency'], createdAt: today });

    const result = getHabitsWithStats([habit], []); // no completions
    expect(result[0].skippedToday).toBe(true);
  });

  // weekday habit on Monday (using a different fake date) → NOT auto-skipped
  it('should set skippedToday=false for weekday habit on Monday with no completion record', () => {
    vi.useRealTimers();
    // 2026-03-16 is a Monday
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T10:00:00.000Z'));

    const today = '2026-03-16'; // Monday
    const habit = makeHabit({ id: 'h1', frequency: 'weekday' as Habit['frequency'], createdAt: today });

    const result = getHabitsWithStats([habit], []);
    expect(result[0].skippedToday).toBe(false);
  });

  // SCENARIO-FS-07 (continued): custom habit on non-target day → auto-skip
  it('should set skippedToday=true for custom [1,3,5] habit on Saturday with no completion record', () => {
    const today = '2026-03-14'; // Saturday (dayOfWeek=6, not in [1,3,5])
    const habit = makeHabit({
      id: 'h1',
      frequency: 'custom' as Habit['frequency'],
      customDays: [1, 3, 5],
      createdAt: today,
    });

    const result = getHabitsWithStats([habit], []);
    expect(result[0].skippedToday).toBe(true);
  });

  // SCENARIO-FS-08: weekday habit on Saturday with status='completed' → skippedToday=false (user override)
  it('should set skippedToday=false for weekday habit on Saturday when user completed it', () => {
    const today = '2026-03-14'; // Saturday
    const habit = makeHabit({ id: 'h1', frequency: 'weekday' as Habit['frequency'], createdAt: today });
    const completions = [makeCompletionTyped('h1', today, 'completed')];

    const result = getHabitsWithStats([habit], completions);
    expect(result[0].skippedToday).toBe(false);
  });

  // SCENARIO-FS-09: weekday habit on Saturday with status='none' → auto-skip overridden (unskip)
  it('should set skippedToday=false for weekday habit on Saturday when user explicitly set none (unskip)', () => {
    const today = '2026-03-14'; // Saturday
    const habit = makeHabit({ id: 'h1', frequency: 'weekday' as Habit['frequency'], createdAt: today });
    // User tapped unskip → setDayStatus(id, today, 'none') wrote a 'none' record to DB
    // Note: HabitCompletion.status does not include 'none' in the current type; this is also a future change.
    // For now we cast to force it through and confirm the logic.
    const completions = [
      {
        habitId: 'h1',
        date: today,
        completedAt: `${today}T10:00:00.000Z`,
        status: 'none' as HabitCompletion['status'],
      },
    ];

    const result = getHabitsWithStats([habit], completions);
    expect(result[0].skippedToday).toBe(false);
  });

  // Manual skip on a target day should work normally (status='skipped' record in DB)
  it('should set skippedToday=true for everyday habit when user manually skipped today', () => {
    const today = '2026-03-14';
    const habit = makeHabit({ id: 'h1', frequency: 'everyday' as Habit['frequency'], createdAt: today });
    const completions = [makeCompletionTyped('h1', today, 'skipped')];

    const result = getHabitsWithStats([habit], completions);
    expect(result[0].skippedToday).toBe(true);
  });

  // everyday habit with no completions → NOT auto-skipped (it's a target day every day)
  it('should set skippedToday=false for everyday habit on Saturday with no completion record', () => {
    const today = '2026-03-14'; // Saturday — but everyday is target every day
    const habit = makeHabit({ id: 'h1', frequency: 'everyday' as Habit['frequency'], createdAt: today });

    const result = getHabitsWithStats([habit], []);
    expect(result[0].skippedToday).toBe(false);
  });
});

// ============================================================
// REQ-FS-07: Daily-type streak — auto-skip days are transparent
// ============================================================

describe('calculateStreak - weekday habit skip transparency', () => {
  /**
   * SCENARIO: weekday habit — Friday completed, Sat+Sun auto-skip (no record), Monday completed
   * Expected: streak not broken (Sat+Sun are treated as transparent like manual skips)
   *
   * The current implementation does NOT handle auto-skip transparency for missing records
   * on non-target days. The new implementation must pass auto-skipped dates as transparent
   * by accepting them in the skippedDates set, OR by computing them internally.
   *
   * For this test we use the overloaded calculateStreak that accepts a Habit argument so
   * it can derive auto-skip days from frequency. If the function signature doesn't support
   * this yet, the test will fail at import/type-check time.
   */
  it('should maintain streak across auto-skipped weekend days for weekday habit', () => {
    // We'll fix today as Monday 2026-03-16 so the calculation is deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T10:00:00.000Z')); // Monday

    const habit = makeHabit({ id: 'h1', frequency: 'weekday' as Habit['frequency'], createdAt: '2026-03-01' });

    // Friday 2026-03-13 completed, Sat 2026-03-14 and Sun 2026-03-15 have NO records (auto-skip)
    // Monday 2026-03-16 completed
    const completions = [
      makeCompletionTyped('h1', '2026-03-13', 'completed'), // Friday
      makeCompletionTyped('h1', '2026-03-16', 'completed'), // Monday (today)
    ];

    // calculateStreak with habit context so it can determine auto-skip days
    const result = calculateStreak('h1', completions, habit);
    // Fri→(Sat auto-skip)→(Sun auto-skip)→Mon: streak should be at least 2
    expect(result.current).toBeGreaterThanOrEqual(2);

    vi.useRealTimers();
  });
});

// ============================================================
// REQ-FS-08: Weekly habit streak (consecutive achieved weeks)
// ============================================================

describe('calculateStreak - weekly habit (consecutive achieved weeks)', () => {
  // SCENARIO-FS-11: 3 consecutive weeks all meeting weeklyTarget=2 → currentStreak=3
  it('should return currentStreak=3 when 3 consecutive weeks each have weeklyTarget completions', () => {
    // Fix today as Wednesday of "this week"
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T10:00:00.000Z')); // Wednesday (ISO week 12 of 2026)

    const habit = makeHabit({
      id: 'h1',
      frequency: 'weekly' as Habit['frequency'],
      weeklyTarget: 2,
      createdAt: '2026-01-01',
    });

    // This week (ISO week 12): 2 completions → achieved
    const thisWeekDay1 = getDateString(getDateForISOWeek(0, 1)); // Mon this week
    const thisWeekDay2 = getDateString(getDateForISOWeek(0, 2)); // Tue this week
    // Last week (ISO week 11): 2 completions → achieved
    const lastWeekDay1 = getDateString(getDateForISOWeek(1, 1));
    const lastWeekDay2 = getDateString(getDateForISOWeek(1, 2));
    // 2 weeks ago (ISO week 10): 2 completions → achieved
    const twoWeeksAgoDay1 = getDateString(getDateForISOWeek(2, 1));
    const twoWeeksAgoDay2 = getDateString(getDateForISOWeek(2, 2));

    const completions = [
      makeCompletionTyped('h1', thisWeekDay1, 'completed'),
      makeCompletionTyped('h1', thisWeekDay2, 'completed'),
      makeCompletionTyped('h1', lastWeekDay1, 'completed'),
      makeCompletionTyped('h1', lastWeekDay2, 'completed'),
      makeCompletionTyped('h1', twoWeeksAgoDay1, 'completed'),
      makeCompletionTyped('h1', twoWeeksAgoDay2, 'completed'),
    ];

    // calculateStreak with habit context for weekly logic
    const result = calculateStreak('h1', completions, habit);
    expect(result.current).toBe(3);

    vi.useRealTimers();
  });

  // SCENARIO-FS-12: current week not yet met → streak is previous streak only
  it('should return currentStreak=1 when current week has not met weeklyTarget but last week did', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T10:00:00.000Z')); // Wednesday

    const habit = makeHabit({
      id: 'h1',
      frequency: 'weekly' as Habit['frequency'],
      weeklyTarget: 2,
      createdAt: '2026-01-01',
    });

    // This week: only 1 completion (not yet achieved, target=2)
    const thisWeekDay1 = getDateString(getDateForISOWeek(0, 1)); // Mon
    // Last week: 2 completions → achieved
    const lastWeekDay1 = getDateString(getDateForISOWeek(1, 1));
    const lastWeekDay2 = getDateString(getDateForISOWeek(1, 2));

    const completions = [
      makeCompletionTyped('h1', thisWeekDay1, 'completed'),
      makeCompletionTyped('h1', lastWeekDay1, 'completed'),
      makeCompletionTyped('h1', lastWeekDay2, 'completed'),
    ];

    const result = calculateStreak('h1', completions, habit);
    expect(result.current).toBe(1); // last week only

    vi.useRealTimers();
  });
});

// ============================================================
// REQ-FS-09: Weekly completionRate (achieved-weeks / 12)
// ============================================================

describe('getCompletionRate - weekly habit (achieved-weeks / 12)', () => {
  // SCENARIO-FS-10: 6 out of 12 weeks achieved → completionRate = 0.5
  it('should return 0.5 when 6 out of 12 weeks meet weeklyTarget=2', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T10:00:00.000Z')); // Wednesday

    const habit = makeHabit({
      id: 'h1',
      frequency: 'weekly' as Habit['frequency'],
      weeklyTarget: 2,
      createdAt: '2025-01-01',
    });

    const completions: HabitCompletion[] = [];

    // Weeks 0–5 (most recent 6 weeks): each week gets 2 completions → achieved
    for (let w = 0; w <= 5; w++) {
      completions.push(makeCompletionTyped('h1', getDateString(getDateForISOWeek(w, 1)), 'completed'));
      completions.push(makeCompletionTyped('h1', getDateString(getDateForISOWeek(w, 2)), 'completed'));
    }
    // Weeks 6–11 (older 6 weeks): each week gets only 1 completion → not achieved
    for (let w = 6; w <= 11; w++) {
      completions.push(makeCompletionTyped('h1', getDateString(getDateForISOWeek(w, 1)), 'completed'));
    }

    // getCompletionRate with habit context for weekly mode
    const rate = getCompletionRate('h1', completions, 12, habit);
    expect(rate).toBeCloseTo(0.5);

    vi.useRealTimers();
  });

  // Additional: all 12 weeks achieved → 1.0
  it('should return 1.0 when all 12 weeks meet weeklyTarget', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T10:00:00.000Z'));

    const habit = makeHabit({
      id: 'h1',
      frequency: 'weekly' as Habit['frequency'],
      weeklyTarget: 1,
      createdAt: '2025-01-01',
    });

    const completions: HabitCompletion[] = [];
    for (let w = 0; w <= 11; w++) {
      completions.push(makeCompletionTyped('h1', getDateString(getDateForISOWeek(w, 1)), 'completed'));
    }

    const rate = getCompletionRate('h1', completions, 12, habit);
    expect(rate).toBeCloseTo(1.0);

    vi.useRealTimers();
  });

  // Additional: 0 weeks achieved → 0.0
  it('should return 0.0 when no week meets weeklyTarget', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T10:00:00.000Z'));

    const habit = makeHabit({
      id: 'h1',
      frequency: 'weekly' as Habit['frequency'],
      weeklyTarget: 3,
      createdAt: '2025-01-01',
    });

    // Each week has only 1 completion (target=3, so none achieved)
    const completions: HabitCompletion[] = [];
    for (let w = 0; w <= 11; w++) {
      completions.push(makeCompletionTyped('h1', getDateString(getDateForISOWeek(w, 1)), 'completed'));
    }

    const rate = getCompletionRate('h1', completions, 12, habit);
    expect(rate).toBeCloseTo(0.0);

    vi.useRealTimers();
  });
});

// ============================================================
// REQ-FS-05 + REQ-FS-06: shouldShowToday + everyday behavior preserved
// ============================================================

describe('shouldShowToday - everyday frequency existing behavior', () => {
  it('should return true for non-archived everyday habit (behavior preserved)', () => {
    const habit = makeHabit({ id: 'h1', frequency: 'everyday' as Habit['frequency'], archived: false });
    expect(shouldShowToday(habit)).toBe(true);
  });

  it('should return false for archived everyday habit (behavior preserved)', () => {
    const habit = makeHabit({ id: 'h1', frequency: 'everyday' as Habit['frequency'], archived: true });
    expect(shouldShowToday(habit)).toBe(false);
  });
});
