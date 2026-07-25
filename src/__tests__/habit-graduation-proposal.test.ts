import { describe, it, expect } from 'vitest';
import {
  GRADUATION_STREAK_THRESHOLD,
  hasJustReachedGraduationThreshold,
  isGraduationCandidate,
} from '@/lib/habits';
import type { Habit } from '@/types/habit';

// issue #91: 連続30日到達時の「卒業」提案導線。
// AC#1: 30日到達の翌チェック時に一度だけ提案が出る（連打・再表示で重複しない）
// AC#3: 「まだ続ける」を選んだ習慣には再提案しない

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

describe('GRADUATION_STREAK_THRESHOLD', () => {
  it('is 30 (issue #91 spec)', () => {
    expect(GRADUATION_STREAK_THRESHOLD).toBe(30);
  });
});

describe('hasJustReachedGraduationThreshold', () => {
  it('prev=29, next=30 のとき true（ちょうど到達した瞬間）', () => {
    expect(hasJustReachedGraduationThreshold(29, 30)).toBe(true);
  });

  it('prev=30, next=31 のとき false（既に到達済みからの続伸では再発火しない = 重複防止）', () => {
    expect(hasJustReachedGraduationThreshold(30, 31)).toBe(false);
  });

  it('prev=30, next=30 のとき false（再レンダーのみで変化なし）', () => {
    expect(hasJustReachedGraduationThreshold(30, 30)).toBe(false);
  });

  it('prev=28, next=29 のとき false（閾値未到達）', () => {
    expect(hasJustReachedGraduationThreshold(28, 29)).toBe(false);
  });

  it('prev=undefined（初回レンダー・スナップショット無し）のとき false', () => {
    expect(hasJustReachedGraduationThreshold(undefined, 30)).toBe(false);
  });

  it('連打で 30 → 29 → 30 と往復しても、遷移のたびに true を返す（呼び出し側が「一度だけ」を保証する責務）', () => {
    // この純関数自体は「29→30 の遷移」を都度検出するだけで、セッション内の重複抑制は
    // 呼び出し側（dashboard-client.tsx の proposedGraduationIdsRef）が担う設計。
    expect(hasJustReachedGraduationThreshold(29, 30)).toBe(true);
    expect(hasJustReachedGraduationThreshold(30, 29)).toBe(false);
    expect(hasJustReachedGraduationThreshold(29, 30)).toBe(true);
  });

  it('カスタム閾値を指定できる', () => {
    expect(hasJustReachedGraduationThreshold(9, 10, 10)).toBe(true);
    expect(hasJustReachedGraduationThreshold(9, 10, 30)).toBe(false);
  });
});

describe('isGraduationCandidate', () => {
  it('active かつ非archived かつ未辞退の習慣は対象になる', () => {
    expect(isGraduationCandidate(makeHabit({ id: 'h1', status: 'active' }))).toBe(true);
  });

  it('既に established の習慣は対象外', () => {
    expect(isGraduationCandidate(makeHabit({ id: 'h1', status: 'established' }))).toBe(false);
  });

  it('archived の習慣は対象外', () => {
    expect(isGraduationCandidate(makeHabit({ id: 'h1', status: 'active', archived: true }))).toBe(false);
  });

  it('graduationDeclinedAt が設定済み（「まだ続ける」を選択済み）の習慣は対象外（AC#3）', () => {
    expect(
      isGraduationCandidate(
        makeHabit({ id: 'h1', status: 'active', graduationDeclinedAt: '2026-07-20T00:00:00Z' })
      )
    ).toBe(false);
  });
});
