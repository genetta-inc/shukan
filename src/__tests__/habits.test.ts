import { describe, it, expect } from 'vitest';
import {
  calculateStreak,
  getCompletionRate,
  calculateRockets,
  getAllDayStatuses,
  getHabitsWithStats,
  isCompletedToday,
  isSkippedToday,
  getRecentDays,
  isDailyTrackedHabit,
  isEstablishedHabit,
} from '@/lib/habits';
import type { HabitCompletion, Habit } from '@/types/habit';
import type { LifeImpactArticle } from '@/types/impact';

// --- Helpers ---

function makeCompletion(habitId: string, date: string, status: string = 'completed'): HabitCompletion {
  return {
    habitId,
    date,
    completedAt: `${date}T00:00:00.000Z`,
    status: status as HabitCompletion['status'],
  };
}

// 型エラーのない正確な HabitCompletion 生成ヘルパー（スキップ機能テスト用）
function makeCompletionTyped(habitId: string, date: string, status: HabitCompletion['status'] = 'completed'): HabitCompletion {
  return {
    habitId,
    date,
    completedAt: `${date}T00:00:00.000Z`,
    status,
  };
}

// 型エラーのない正確な Habit 生成ヘルパー（スキップ機能テスト用）
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

// --- Tests ---

describe('isCompletedToday', () => {
  it('今日completedがあればtrue', () => {
    const today = getDateString(new Date());
    const completions = [makeCompletion('h1', today, 'completed')];
    expect(isCompletedToday('h1', completions)).toBe(true);
  });

  it('今日rocket_usedがあればtrue', () => {
    const today = getDateString(new Date());
    const completions = [makeCompletion('h1', today, 'rocket_used')];
    expect(isCompletedToday('h1', completions)).toBe(true);
  });

  it('今日failedのみならfalse', () => {
    const today = getDateString(new Date());
    const completions = [makeCompletion('h1', today, 'failed')];
    expect(isCompletedToday('h1', completions)).toBe(false);
  });

  it('今日のcompletionがなければfalse', () => {
    const completions = [makeCompletion('h1', '2026-01-01', 'completed')];
    expect(isCompletedToday('h1', completions)).toBe(false);
  });

  it('別の習慣のcompletionはfalse', () => {
    const today = getDateString(new Date());
    const completions = [makeCompletion('h2', today, 'completed')];
    expect(isCompletedToday('h1', completions)).toBe(false);
  });
});

describe('calculateStreak', () => {
  it('completionが0件なら current=0, longest=0', () => {
    expect(calculateStreak('h1', [])).toEqual({ current: 0, longest: 0 });
  });

  it('今日だけ完了なら current=1, longest=1', () => {
    const today = getDateString(new Date());
    const completions = [makeCompletion('h1', today)];
    expect(calculateStreak('h1', completions)).toEqual({ current: 1, longest: 1 });
  });

  it('連続3日（今日含む）なら current=3', () => {
    const today = new Date();
    const dates = [];
    for (let i = 2; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dates.push(getDateString(d));
    }
    const completions = dates.map(d => makeCompletion('h1', d));
    const result = calculateStreak('h1', completions);
    expect(result.current).toBe(3);
    expect(result.longest).toBe(3);
  });

  it('昨日までの連続5日（今日は未完了）なら current=5', () => {
    const today = new Date();
    const dates = [];
    for (let i = 5; i >= 1; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dates.push(getDateString(d));
    }
    const completions = dates.map(d => makeCompletion('h1', d));
    const result = calculateStreak('h1', completions);
    expect(result.current).toBe(5);
  });

  it('2日前に途切れていれば current=0', () => {
    const today = new Date();
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const completions = [makeCompletion('h1', getDateString(twoDaysAgo))];
    const result = calculateStreak('h1', completions);
    expect(result.current).toBe(0);
  });

  it('rocket_usedもストリークにカウントされる', () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const completions = [
      makeCompletion('h1', getDateString(yesterday), 'completed'),
      makeCompletion('h1', getDateString(today), 'rocket_used'),
    ];
    const result = calculateStreak('h1', completions);
    expect(result.current).toBe(2);
  });

  it('failedはストリークに含まれない', () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const completions = [
      makeCompletion('h1', getDateString(yesterday), 'failed'),
      makeCompletion('h1', getDateString(today), 'completed'),
    ];
    const result = calculateStreak('h1', completions);
    expect(result.current).toBe(1); // failedで途切れる
  });

  it('longestは過去の最長ストリークを反映', () => {
    const today = new Date();
    // 20日前から15日前まで6日連続、今日だけ完了
    const dates = [];
    for (let i = 20; i >= 15; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dates.push(getDateString(d));
    }
    dates.push(getDateString(today));
    const completions = dates.map(d => makeCompletion('h1', d));
    const result = calculateStreak('h1', completions);
    expect(result.current).toBe(1);
    expect(result.longest).toBe(6);
  });
});

describe('getCompletionRate', () => {
  it('全日完了なら1.0', () => {
    const today = new Date();
    const completions = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      completions.push(makeCompletion('h1', getDateString(d)));
    }
    expect(getCompletionRate('h1', completions, 7)).toBe(1.0);
  });

  it('半分完了なら0.5', () => {
    const today = new Date();
    const completions = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i * 2);
      completions.push(makeCompletion('h1', getDateString(d)));
    }
    expect(getCompletionRate('h1', completions, 10)).toBe(0.5);
  });

  it('days=0の場合0を返す', () => {
    expect(getCompletionRate('h1', [], 0)).toBe(0);
  });
});

describe('calculateRockets', () => {
  it('completionが0件なら rockets=0, nextIn=10', () => {
    expect(calculateRockets('h1', [])).toEqual({ rockets: 0, nextIn: 10 });
  });

  it('連続10日でロケット1個獲得', () => {
    const today = new Date();
    const completions = [];
    for (let i = 9; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      completions.push(makeCompletion('h1', getDateString(d)));
    }
    const result = calculateRockets('h1', completions);
    expect(result.rockets).toBe(1);
  });

  it('連続20日でロケット2個獲得', () => {
    const today = new Date();
    const completions = [];
    for (let i = 19; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      completions.push(makeCompletion('h1', getDateString(d)));
    }
    const result = calculateRockets('h1', completions);
    expect(result.rockets).toBe(2);
  });

  it('rocket_usedの分だけ減算される', () => {
    const today = new Date();
    const completions: HabitCompletion[] = [];
    for (let i = 9; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      completions.push(makeCompletion('h1', getDateString(d)));
    }
    // 1つ使用済み
    const d11 = new Date(today);
    d11.setDate(d11.getDate() + 1);
    completions.push(makeCompletion('h1', getDateString(d11), 'rocket_used'));
    const result = calculateRockets('h1', completions);
    expect(result.rockets).toBe(0); // 1 earned - 1 used = 0
  });

  it('nextInは次のロケットまでの残り日数', () => {
    const today = new Date();
    const completions = [];
    for (let i = 2; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      completions.push(makeCompletion('h1', getDateString(d)));
    }
    const result = calculateRockets('h1', completions);
    expect(result.nextIn).toBe(7); // 10 - 3 = 7
  });
});

describe('getAllDayStatuses', () => {
  it('完了した日はcompletedステータス', () => {
    const today = getDateString(new Date());
    const completions = [makeCompletion('h1', today, 'completed')];
    const result = getAllDayStatuses('h1', completions, today);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('completed');
  });

  it('7日以上前の未完了日はfailedになる（境界は EDITABLE_PAST_DAYS=6。issue #107）', () => {
    const today = new Date();
    const tenDaysAgo = new Date(today);
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const result = getAllDayStatuses('h1', [], getDateString(tenDaysAgo));
    // 10日前〜今日 = 11日分
    expect(result).toHaveLength(11);
    // 編集可能枠（6日）より古い日はfailed
    const failedDays = result.filter(d => d.status === 'failed');
    expect(failedDays.length).toBe(4); // 10,9,8,7日前
    // 6日以内はnone
    const noneDays = result.filter(d => d.status === 'none');
    expect(noneDays.length).toBe(7); // 6,5,4,3,2,1,0日前
  });
});

describe('getHabitsWithStats - multi-evidence', () => {
  const mockArticle: LifeImpactArticle = {
    habitCategory: 'quit_smoking',
    habitName: '禁煙',
    article: { researchBody: '', sources: [] },
    inferences: { health: '', cost: '', income: '', cumulative: '' },
    calculationParams: { dailyHealthMinutes: 30, dailyCostSaving: 500, dailyIncomeGain: 100, dailyPositiveMoodMinutes: 0 },
    confidenceLevel: 'high',
    defaultHabitType: 'quit',
    defaultIcon: 'cigarette-off',
  };

  const getArticle = (id: string) => id === 'quit_smoking' ? mockArticle : undefined;

  it('evidences配列があればマルチエビデンス計算を使用', () => {
    const today = getDateString(new Date());
    const habits: Habit[] = [{
      id: 'h1',
      name: 'Test',
      icon: 'target',
      type: 'quit',
      frequency: 'everyday',
      createdAt: today,
      archived: false,
      sortOrder: 0,
      status: 'active',
      evidences: [{ id: 'ev1', habitId: 'h1', articleId: 'quit_smoking' as const, weight: 100 }],
    }];
    const completions = [makeCompletion('h1', today)];

    const result = getHabitsWithStats(habits, completions, getArticle);
    expect(result[0].impactSavings).toBeDefined();
    expect(result[0].impactSavings!.completedDays).toBe(1);
    expect(result[0].impactSavings!.healthMinutes).toBe(30);
  });

  it('evidencesが空でimpactArticleIdがあればレガシー計算を使用', () => {
    const today = getDateString(new Date());
    const habits: Habit[] = [{
      id: 'h1',
      name: 'Test',
      icon: 'target',
      type: 'quit',
      frequency: 'everyday',
      createdAt: today,
      archived: false,
      sortOrder: 0,
      status: 'active',
      evidences: [],
      impactArticleId: 'quit_smoking' as const,
    }];
    const completions = [makeCompletion('h1', today)];

    const result = getHabitsWithStats(habits, completions, getArticle);
    expect(result[0].impactSavings).toBeDefined();
    expect(result[0].impactSavings!.completedDays).toBe(1);
  });

  it('エビデンスもimpactArticleIdもなければimpactSavingsなし', () => {
    const today = getDateString(new Date());
    const habits: Habit[] = [{
      id: 'h1',
      name: 'Test',
      icon: 'target',
      type: 'positive',
      frequency: 'everyday',
      createdAt: today,
      archived: false,
      sortOrder: 0,
      status: 'active',
      evidences: [],
    }];

    const result = getHabitsWithStats(habits, [], getArticle);
    expect(result[0].impactSavings).toBeUndefined();
  });
});

// ============================================================
// スキップ機能テスト
// ============================================================

describe('isSkippedToday', () => {
  it('should return true when today completion status is skipped', () => {
    const today = getDateString(new Date());
    const completions = [makeCompletionTyped('h1', today, 'skipped')];
    expect(isSkippedToday('h1', completions)).toBe(true);
  });

  it('should return false when there is no completion for today', () => {
    const completions = [makeCompletionTyped('h1', '2026-01-01', 'skipped')];
    expect(isSkippedToday('h1', completions)).toBe(false);
  });

  it('should return false when today completion status is completed', () => {
    const today = getDateString(new Date());
    const completions = [makeCompletionTyped('h1', today, 'completed')];
    expect(isSkippedToday('h1', completions)).toBe(false);
  });

  it('should return false when today completion status is rocket_used', () => {
    const today = getDateString(new Date());
    const completions = [makeCompletionTyped('h1', today, 'rocket_used')];
    expect(isSkippedToday('h1', completions)).toBe(false);
  });

  it('should return false when completions array is empty', () => {
    expect(isSkippedToday('h1', [])).toBe(false);
  });

  it('should return false when only a different habit is skipped today', () => {
    const today = getDateString(new Date());
    const completions = [makeCompletionTyped('h2', today, 'skipped')];
    expect(isSkippedToday('h1', completions)).toBe(false);
  });
});

describe('calculateStreak - skip support', () => {
  it('should not break streak when today is skipped', () => {
    const today = new Date();
    const todayStr = getDateString(today);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getDateString(yesterday);

    const completions = [
      makeCompletionTyped('h1', yesterdayStr, 'completed'),
      makeCompletionTyped('h1', todayStr, 'skipped'),
    ];
    const result = calculateStreak('h1', completions);
    // 昨日が完了、今日がスキップ → ストリーク継続で current=1（スキップはカウントしない）
    expect(result.current).toBe(1);
  });

  it('should count skipped day as transparent: completed -> skipped -> completed = 2 day streak', () => {
    const today = new Date();
    const todayStr = getDateString(today);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getDateString(yesterday);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = getDateString(twoDaysAgo);

    const completions = [
      makeCompletionTyped('h1', twoDaysAgoStr, 'completed'),
      makeCompletionTyped('h1', yesterdayStr, 'skipped'),
      makeCompletionTyped('h1', todayStr, 'completed'),
    ];
    const result = calculateStreak('h1', completions);
    // 完了→スキップ→完了 = スキップは透明、2日連続扱い
    expect(result.current).toBe(2);
  });

  it('should handle multiple skipped days: 5 completed -> 2 skipped -> 3 completed = 8 day streak', () => {
    const today = new Date();
    const completions: HabitCompletion[] = [];

    // 今日から0〜2日前: 3日完了
    for (let i = 0; i <= 2; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      completions.push(makeCompletionTyped('h1', getDateString(d), 'completed'));
    }
    // 3〜4日前: 2日スキップ
    for (let i = 3; i <= 4; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      completions.push(makeCompletionTyped('h1', getDateString(d), 'skipped'));
    }
    // 5〜9日前: 5日完了
    for (let i = 5; i <= 9; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      completions.push(makeCompletionTyped('h1', getDateString(d), 'completed'));
    }

    const result = calculateStreak('h1', completions);
    // スキップ2日は透明 → 完了8日がつながる
    expect(result.current).toBe(8);
  });

  it('should not count skipped days in streak count', () => {
    const today = new Date();
    const todayStr = getDateString(today);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getDateString(yesterday);

    const completions = [
      makeCompletionTyped('h1', yesterdayStr, 'skipped'),
      makeCompletionTyped('h1', todayStr, 'completed'),
    ];
    const result = calculateStreak('h1', completions);
    // スキップはカウントしないので completed=1のみ
    expect(result.current).toBe(1);
  });

  it('should break streak when non-skipped gap exists between completed days', () => {
    const today = new Date();
    const todayStr = getDateString(today);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = getDateString(twoDaysAgo);
    // 昨日は未記録（スキップでもない）

    const completions = [
      makeCompletionTyped('h1', twoDaysAgoStr, 'completed'),
      makeCompletionTyped('h1', todayStr, 'completed'),
    ];
    const result = calculateStreak('h1', completions);
    // 昨日が空白（スキップなし）なので今日のみ
    expect(result.current).toBe(1);
  });

  it('should reflect longest streak correctly when skipped days fill the gap', () => {
    const today = new Date();
    const completions: HabitCompletion[] = [];

    // 今日だけ完了
    completions.push(makeCompletionTyped('h1', getDateString(today), 'completed'));

    // 10〜15日前: 6日完了、間に8〜9日前スキップ
    for (let i = 15; i >= 10; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      completions.push(makeCompletionTyped('h1', getDateString(d), 'completed'));
    }
    // スキップで埋める（8〜9日前）
    for (let i = 9; i >= 8; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      completions.push(makeCompletionTyped('h1', getDateString(d), 'skipped'));
    }
    // 6〜7日前: 2日完了
    for (let i = 7; i >= 6; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      completions.push(makeCompletionTyped('h1', getDateString(d), 'completed'));
    }

    const result = calculateStreak('h1', completions);
    // 過去の最長: 6+スキップ2+2=8日連続（スキップ透明）
    expect(result.longest).toBeGreaterThanOrEqual(8);
    // 今日のみ current=1
    expect(result.current).toBe(1);
  });
});

describe('getCompletionRate - skip support', () => {
  it('should exclude skipped days from denominator', () => {
    const today = new Date();
    const completions: HabitCompletion[] = [];
    const days = 30;

    // 10日完了
    for (let i = 0; i < 10; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      completions.push(makeCompletionTyped('h1', getDateString(d), 'completed'));
    }
    // 5日スキップ（11〜15日前）
    for (let i = 11; i <= 15; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      completions.push(makeCompletionTyped('h1', getDateString(d), 'skipped'));
    }

    const rate = getCompletionRate('h1', completions, days);
    // 10 / (30 - 5) = 0.4
    expect(rate).toBeCloseTo(0.4);
  });

  it('should return 0 when all days in period are skipped', () => {
    const today = new Date();
    const completions: HabitCompletion[] = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      completions.push(makeCompletionTyped('h1', getDateString(d), 'skipped'));
    }

    const rate = getCompletionRate('h1', completions, 7);
    // effectiveDays = 0 → 0を返す
    expect(rate).toBe(0);
  });

  it('should return 1.0 when all non-skipped days are completed', () => {
    const today = new Date();
    const completions: HabitCompletion[] = [];

    // 5日完了
    for (let i = 0; i < 5; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      completions.push(makeCompletionTyped('h1', getDateString(d), 'completed'));
    }
    // 5日スキップ（6〜10日前）
    for (let i = 5; i < 10; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      completions.push(makeCompletionTyped('h1', getDateString(d), 'skipped'));
    }

    const rate = getCompletionRate('h1', completions, 10);
    // 5 / (10 - 5) = 1.0
    expect(rate).toBe(1.0);
  });

  it('should count skipped days in period range boundary correctly', () => {
    const today = new Date();
    const completions: HabitCompletion[] = [];
    const days = 7;

    // 期間外（8日前）のスキップは無視される
    const eightDaysAgo = new Date(today);
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
    completions.push(makeCompletionTyped('h1', getDateString(eightDaysAgo), 'skipped'));

    // 今日だけ完了
    completions.push(makeCompletionTyped('h1', getDateString(today), 'completed'));

    const rate = getCompletionRate('h1', completions, days);
    // 有効日数7日、完了1日 → 1/7
    expect(rate).toBeCloseTo(1 / 7);
  });
});

describe('getRecentDays - skip support', () => {
  it('should return skipped status for skipped days', () => {
    const today = new Date();
    const todayStr = getDateString(today);
    const completions = [makeCompletionTyped('h1', todayStr, 'skipped')];

    const result = getRecentDays('h1', completions, 5);
    expect(result[0].date).toBe(todayStr);
    expect(result[0].status).toBe('skipped');
  });

  it('should return none when day has no completion record', () => {
    const result = getRecentDays('h1', [], 3);
    expect(result).toHaveLength(3);
    result.forEach(day => {
      expect(day.status).toBe('none');
    });
  });

  it('should correctly mix completed and skipped statuses', () => {
    const today = new Date();
    const todayStr = getDateString(today);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getDateString(yesterday);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = getDateString(twoDaysAgo);

    const completions = [
      makeCompletionTyped('h1', todayStr, 'completed'),
      makeCompletionTyped('h1', yesterdayStr, 'skipped'),
      makeCompletionTyped('h1', twoDaysAgoStr, 'completed'),
    ];

    const result = getRecentDays('h1', completions, 3);
    expect(result[0].status).toBe('completed');  // 今日
    expect(result[1].status).toBe('skipped');    // 昨日
    expect(result[2].status).toBe('completed');  // 2日前
  });

  it('should return days in order from today to past', () => {
    const today = new Date();
    const result = getRecentDays('h1', [], 5);
    expect(result).toHaveLength(5);
    // 最初が今日、以降は過去に向かう
    expect(result[0].date).toBe(getDateString(today));
    for (let i = 1; i < result.length; i++) {
      expect(result[i].date < result[i - 1].date).toBe(true);
    }
  });
});

// ============================================================
// 3場面構造: established はデイリー系指標から除外する（受け入れ条件 #10-b）
// ============================================================

describe('established habit exclusion from daily metrics', () => {
  it('established habits are not daily-tracked; active habits are', () => {
    const active = makeHabit({ id: 'a', status: 'active' });
    const established = makeHabit({ id: 'e', status: 'established' });
    expect(isDailyTrackedHabit(active)).toBe(true);
    expect(isDailyTrackedHabit(established)).toBe(false);
    expect(isEstablishedHabit(established)).toBe(true);
  });

  it('excludes established habits from the completion-rate denominator (avg over active only)', () => {
    // stats page averages completionRate over daily-tracked habits only.
    // An established habit must not dilute the average.
    const withStats = getHabitsWithStats(
      [
        makeHabit({ id: 'a', status: 'active' }),
        makeHabit({ id: 'e', status: 'established' }),
      ],
      []
    );
    const dailyTracked = withStats.filter(isDailyTrackedHabit);
    expect(dailyTracked).toHaveLength(1);
    expect(dailyTracked[0].id).toBe('a');
  });

  it('excludes established habits from streak aggregation', () => {
    const today = getDateString(new Date());
    const yesterday = getDateString(new Date(Date.now() - 86400000));
    const completions = [
      makeCompletion('a', today),
      makeCompletion('a', yesterday),
      makeCompletion('e', today),
      makeCompletion('e', yesterday),
    ];
    const withStats = getHabitsWithStats(
      [
        makeHabit({ id: 'a', status: 'active' }),
        makeHabit({ id: 'e', status: 'established' }),
      ],
      completions
    );
    const dailyTracked = withStats.filter(isDailyTrackedHabit);
    const totalStreak = dailyTracked.reduce((s, h) => s + h.currentStreak, 0);
    // Only the active habit's streak counts; the established one is excluded.
    expect(dailyTracked).toHaveLength(1);
    expect(totalStreak).toBe(withStats.find((h) => h.id === 'a')!.currentStreak);
  });
});

describe('getHabitsWithStats - skippedToday', () => {
  it('should set skippedToday to true when habit is skipped today', () => {
    const today = getDateString(new Date());
    const habit = makeHabit({ id: 'h1', createdAt: today });
    const completions = [makeCompletionTyped('h1', today, 'skipped')];

    const result = getHabitsWithStats([habit], completions);
    expect(result[0].skippedToday).toBe(true);
  });

  it('should set skippedToday to false when habit is not skipped today', () => {
    const today = getDateString(new Date());
    const habit = makeHabit({ id: 'h1', createdAt: today });
    const completions = [makeCompletionTyped('h1', today, 'completed')];

    const result = getHabitsWithStats([habit], completions);
    expect(result[0].skippedToday).toBe(false);
  });

  it('should set skippedToday to false when there is no completion for today', () => {
    const today = getDateString(new Date());
    const habit = makeHabit({ id: 'h1', createdAt: today });

    const result = getHabitsWithStats([habit], []);
    expect(result[0].skippedToday).toBe(false);
  });

  it('should set skippedToday independently for each habit', () => {
    const today = getDateString(new Date());
    const habit1 = makeHabit({ id: 'h1', createdAt: today });
    const habit2 = makeHabit({ id: 'h2', createdAt: today });

    const completions = [
      makeCompletionTyped('h1', today, 'skipped'),
      makeCompletionTyped('h2', today, 'completed'),
    ];

    const result = getHabitsWithStats([habit1, habit2], completions);
    expect(result[0].skippedToday).toBe(true);
    expect(result[1].skippedToday).toBe(false);
  });
});
