import { describe, it, expect } from 'vitest';
import { ARTICLE_VERDICTS, isArticleVerdict, findVoterStreakForArticle } from '@/lib/verdicts';
import type { Habit, HabitCompletion } from '@/types/habit';

// issue #89: エビデンス記事への構造化投票。純粋ロジック（UI/DB非依存）のテスト。

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

function makeCompletion(habitId: string, date: string, status: HabitCompletion['status'] = 'completed'): HabitCompletion {
  return {
    habitId,
    date,
    completedAt: `${date}T00:00:00.000Z`,
    status,
  };
}

describe('isArticleVerdict', () => {
  it('4択の値のみ true を返す', () => {
    for (const v of ARTICLE_VERDICTS) {
      expect(isArticleVerdict(v)).toBe(true);
    }
  });

  it('未知の値は false（不正な verdict の混入防止）', () => {
    expect(isArticleVerdict('too_much')).toBe(false);
    expect(isArticleVerdict('')).toBe(false);
  });
});

describe('findVoterStreakForArticle（受け入れ条件2: 継続日数スナップショット）', () => {
  const today = '2026-07-24';
  const yesterday = '2026-07-23';
  const dayBefore = '2026-07-22';

  it('記事に紐づく習慣が無ければ 0 を返す（Discover 未追加・オンボーディング中等）', () => {
    const habits: Habit[] = [makeHabit({ id: 'h1', evidences: [] })];
    const completions: HabitCompletion[] = [];
    expect(findVoterStreakForArticle(habits, completions, 'walking-10min')).toBe(0);
  });

  it('evidences に紐づく習慣の継続日数を返す', () => {
    const habits: Habit[] = [
      makeHabit({
        id: 'h1',
        evidences: [{ id: 'e1', habitId: 'h1', articleId: 'walking-10min', weight: 100 }],
      }),
    ];
    const completions: HabitCompletion[] = [
      makeCompletion('h1', today),
      makeCompletion('h1', yesterday),
      makeCompletion('h1', dayBefore),
    ];
    expect(findVoterStreakForArticle(habits, completions, 'walking-10min')).toBe(3);
  });

  it('legacy の impactArticleId でも紐付けを解決する（後方互換）', () => {
    const habits: Habit[] = [
      makeHabit({ id: 'h1', impactArticleId: 'walking-10min', evidences: [] }),
    ];
    const completions: HabitCompletion[] = [makeCompletion('h1', today)];
    expect(findVoterStreakForArticle(habits, completions, 'walking-10min')).toBe(1);
  });

  it('複数の習慣が同じ記事に紐づく場合は最大値を採用する', () => {
    const habits: Habit[] = [
      makeHabit({
        id: 'h1',
        evidences: [{ id: 'e1', habitId: 'h1', articleId: 'walking-10min', weight: 50 }],
      }),
      makeHabit({
        id: 'h2',
        evidences: [{ id: 'e2', habitId: 'h2', articleId: 'walking-10min', weight: 50 }],
      }),
    ];
    const completions: HabitCompletion[] = [
      makeCompletion('h1', today),
      makeCompletion('h2', today),
      makeCompletion('h2', yesterday),
      makeCompletion('h2', dayBefore),
    ];
    expect(findVoterStreakForArticle(habits, completions, 'walking-10min')).toBe(3);
  });

  it('アーカイブ済み習慣は対象外', () => {
    const habits: Habit[] = [
      makeHabit({
        id: 'h1',
        archived: true,
        evidences: [{ id: 'e1', habitId: 'h1', articleId: 'walking-10min', weight: 100 }],
      }),
    ];
    const completions: HabitCompletion[] = [makeCompletion('h1', today)];
    expect(findVoterStreakForArticle(habits, completions, 'walking-10min')).toBe(0);
  });
});
