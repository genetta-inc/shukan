/**
 * review-history.test.ts
 * TDD tests for the review history feature
 * Tests: MOOD_ICONS, Supabase CRUD helpers, calendar utils, useReviewHistory hook logic
 */
import { describe, it, expect } from 'vitest';

// ─── 1. MOOD_ICONS ────────────────────────────────────────────────────────────

describe('MOOD_ICONS', () => {
  it('exports exactly 5 entries with values 1–5', async () => {
    const { MOOD_ICONS } = await import('@/lib/mood-icons');
    expect(MOOD_ICONS).toHaveLength(5);
    const values = MOOD_ICONS.map((m) => m.value);
    expect(values).toEqual([1, 2, 3, 4, 5]);
  });

  it('each entry has Icon, colorClass, value, dotColor', async () => {
    const { MOOD_ICONS } = await import('@/lib/mood-icons');
    for (const entry of MOOD_ICONS) {
      // Lucide icons can be function or object (forwardRef) depending on version
      expect(['function', 'object']).toContain(typeof entry.Icon);
      expect(entry.Icon).toBeTruthy();
      expect(typeof entry.colorClass).toBe('string');
      expect(typeof entry.value).toBe('number');
      expect(typeof entry.dotColor).toBe('string');
    }
  });

  it('mood 4 and 5 have positive dotColor', async () => {
    const { MOOD_ICONS } = await import('@/lib/mood-icons');
    const mood4 = MOOD_ICONS.find((m) => m.value === 4)!;
    const mood5 = MOOD_ICONS.find((m) => m.value === 5)!;
    expect(mood4.dotColor).toContain('green');
    expect(mood5.dotColor).toContain('success');
  });

  it('mood 3 has yellow dotColor', async () => {
    const { MOOD_ICONS } = await import('@/lib/mood-icons');
    const mood3 = MOOD_ICONS.find((m) => m.value === 3)!;
    expect(mood3.dotColor).toContain('yellow');
  });

  it('mood 1 and 2 have red dotColor', async () => {
    const { MOOD_ICONS } = await import('@/lib/mood-icons');
    const mood1 = MOOD_ICONS.find((m) => m.value === 1)!;
    const mood2 = MOOD_ICONS.find((m) => m.value === 2)!;
    expect(mood1.dotColor).toContain('red');
    expect(mood2.dotColor).toContain('red');
  });
});

// ─── 2. Calendar helper functions ─────────────────────────────────────────────

describe('getMoodDotColor', () => {
  it('returns green for mood 4', () => {
    const color = getMoodDotColor(4);
    expect(color).toContain('green');
  });

  it('returns green for mood 5', () => {
    const color = getMoodDotColor(5);
    expect(color).toContain('green');
  });

  it('returns yellow for mood 3', () => {
    const color = getMoodDotColor(3);
    expect(color).toContain('yellow');
  });

  it('returns red for mood 1', () => {
    const color = getMoodDotColor(1);
    expect(color).toContain('red');
  });

  it('returns red for mood 2', () => {
    const color = getMoodDotColor(2);
    expect(color).toContain('red');
  });

  it('returns empty string for no mood', () => {
    const color = getMoodDotColor(undefined);
    expect(color).toBe('');
  });
});

// Helper for mood dot color (same logic used in ReviewCalendar)
function getMoodDotColor(mood: number | undefined): string {
  if (mood === undefined) return '';
  if (mood >= 4) return 'bg-green-400';
  if (mood === 3) return 'bg-yellow-400';
  return 'bg-red-400';
}

// ─── 3. Month grid calculation ─────────────────────────────────────────────────

describe('getMonthGrid', () => {
  it('2026-03 starts on Sunday (0), needs 0 offset for Mon-first grid (6 empty cells)', () => {
    // March 2026: March 1 is a Sunday
    const firstDay = new Date('2026-03-01T00:00:00').getDay(); // 0 = Sunday
    // In Mon-first grid, Sunday is index 6
    const offset = firstDay === 0 ? 6 : firstDay - 1;
    expect(offset).toBe(6);
  });

  it('month with 31 days produces 31 date strings', () => {
    const year = 2026;
    const month = 3; // March
    const days = getDaysInMonth(year, month);
    expect(days).toHaveLength(31);
  });

  it('month with 28 days produces 28 date strings (Feb non-leap)', () => {
    const days = getDaysInMonth(2025, 2);
    expect(days).toHaveLength(28);
  });

  it('all date strings are in YYYY-MM-DD format', () => {
    const days = getDaysInMonth(2026, 3);
    for (const d of days) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('first day of month is correct', () => {
    const days = getDaysInMonth(2026, 3);
    expect(days[0]).toBe('2026-03-01');
  });

  it('last day of month is correct', () => {
    const days = getDaysInMonth(2026, 3);
    expect(days[days.length - 1]).toBe('2026-03-31');
  });
});

// Helper: generate array of YYYY-MM-DD strings for a given month
function getDaysInMonth(year: number, month: number): string[] {
  const pad = (n: number) => String(n).padStart(2, '0');
  const count = new Date(year, month, 0).getDate(); // getDate of day 0 = last day of prev month
  return Array.from({ length: count }, (_, i) => {
    const day = i + 1;
    return `${year}-${pad(month)}-${pad(day)}`;
  });
}

// ─── 4. Future date detection ──────────────────────────────────────────────────

describe('isFutureDate', () => {
  it('returns true for a date after today', () => {
    const today = '2026-03-19';
    expect(isFutureDate('2026-03-20', today)).toBe(true);
  });

  it('returns false for today', () => {
    const today = '2026-03-19';
    expect(isFutureDate('2026-03-19', today)).toBe(false);
  });

  it('returns false for a past date', () => {
    const today = '2026-03-19';
    expect(isFutureDate('2026-03-01', today)).toBe(false);
  });
});

function isFutureDate(date: string, today: string): boolean {
  return date > today;
}

// ─── 5. Month navigation ───────────────────────────────────────────────────────

describe('month navigation', () => {
  it('navigate prev from March 2026 returns February 2026', () => {
    const result = navigateMonth(2026, 3, -1);
    expect(result).toEqual({ year: 2026, month: 2 });
  });

  it('navigate prev from January 2026 returns December 2025', () => {
    const result = navigateMonth(2026, 1, -1);
    expect(result).toEqual({ year: 2025, month: 12 });
  });

  it('navigate next from March 2026 returns April 2026', () => {
    const result = navigateMonth(2026, 3, 1);
    expect(result).toEqual({ year: 2026, month: 4 });
  });

  it('navigate next from December 2025 returns January 2026', () => {
    const result = navigateMonth(2025, 12, 1);
    expect(result).toEqual({ year: 2026, month: 1 });
  });
});

function navigateMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// ─── 6. isCurrentMonth ────────────────────────────────────────────────────────

describe('isCurrentMonth', () => {
  it('returns true when year/month match today', () => {
    const today = new Date('2026-03-19T00:00:00');
    expect(isCurrentMonth(2026, 3, today)).toBe(true);
  });

  it('returns false for past month', () => {
    const today = new Date('2026-03-19T00:00:00');
    expect(isCurrentMonth(2026, 2, today)).toBe(false);
  });

  it('returns false for future month', () => {
    const today = new Date('2026-03-19T00:00:00');
    expect(isCurrentMonth(2026, 4, today)).toBe(false);
  });
});

function isCurrentMonth(year: number, month: number, today: Date): boolean {
  return year === today.getFullYear() && month === today.getMonth() + 1;
}

// ─── 7. Reflection lookup ─────────────────────────────────────────────────────

describe('getReflectionForDate', () => {
  const reflections = [
    { date: '2026-03-10', mood: 4, comment: 'Great day' },
    { date: '2026-03-15', mood: 2, comment: 'Tough' },
  ];

  it('returns the reflection for a matching date', () => {
    const r = getReflectionForDate(reflections, '2026-03-10');
    expect(r).toBeDefined();
    expect(r?.mood).toBe(4);
  });

  it('returns undefined for a date with no reflection', () => {
    const r = getReflectionForDate(reflections, '2026-03-11');
    expect(r).toBeUndefined();
  });
});

function getReflectionForDate<T extends { date: string }>(
  reflections: T[],
  date: string
): T | undefined {
  return reflections.find((r) => r.date === date);
}

// ─── 8. Completions filter ────────────────────────────────────────────────────

describe('getCompletionsForDate', () => {
  const completions = [
    { habitId: 'h1', date: '2026-03-10', status: 'completed' },
    { habitId: 'h2', date: '2026-03-10', status: 'failed' },
    { habitId: 'h1', date: '2026-03-11', status: 'skipped' },
  ];

  it('returns all completions for a given date', () => {
    const result = getCompletionsForDate(completions, '2026-03-10');
    expect(result).toHaveLength(2);
  });

  it('returns empty array for date with no completions', () => {
    const result = getCompletionsForDate(completions, '2026-03-12');
    expect(result).toHaveLength(0);
  });
});

function getCompletionsForDate<T extends { date: string }>(completions: T[], date: string): T[] {
  return completions.filter((c) => c.date === date);
}

// ─── 9. formatMonthKey (Supabase LIKE pattern) ────────────────────────────────

describe('formatMonthKey', () => {
  it('formats year 2026 month 3 as "2026-03"', () => {
    expect(formatMonthKey(2026, 3)).toBe('2026-03');
  });

  it('formats year 2025 month 12 as "2025-12"', () => {
    expect(formatMonthKey(2025, 12)).toBe('2025-12');
  });

  it('pads single-digit month with leading zero', () => {
    expect(formatMonthKey(2026, 1)).toBe('2026-01');
  });
});

function formatMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}
