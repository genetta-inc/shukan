import { describe, it, expect } from 'vitest';
import { toHabit, type HabitRow } from '@/lib/supabase/habits';

// issue #91: graduation_declined_at の snake_case↔camelCase 読み出しマッピング検証。
// 書き込み（updateHabitById）は Supabase クライアントに依存し実 DB なしではテストできないため、
// 既存の habit-status-crud.test.ts と同様に純粋関数 toHabit のみを対象にする。

function baseRow(overrides: Partial<HabitRow> = {}): HabitRow {
  return {
    id: 'h1',
    user_id: 'u1',
    name: 'Test',
    description: null,
    life_significance: null,
    icon: 'target',
    frequency: 'everyday',
    custom_days: null,
    type: 'positive',
    weekly_target: 1,
    created_at: '2026-01-01',
    archived: false,
    impact_article_id: null,
    sort_order: 0,
    status: 'active',
    established_since: null,
    graduation_declined_at: null,
    ...overrides,
  };
}

describe('toHabit: graduation_declined_at 読み出しマッピング', () => {
  it('graduation_declined_at (snake) を graduationDeclinedAt (camel) に写す', () => {
    const habit = toHabit(baseRow({ graduation_declined_at: '2026-07-25T00:00:00Z' }));
    expect(habit.graduationDeclinedAt).toBe('2026-07-25T00:00:00Z');
  });

  it('graduation_declined_at が null なら graduationDeclinedAt は undefined', () => {
    const habit = toHabit(baseRow({ graduation_declined_at: null }));
    expect(habit.graduationDeclinedAt).toBeUndefined();
  });

  it('graduation_declined_at が undefined（未マイグレーション行 / select 漏れ）でも undefined にフォールバックする', () => {
    const row = baseRow();
    delete (row as Partial<HabitRow>).graduation_declined_at;
    const habit = toHabit(row);
    expect(habit.graduationDeclinedAt).toBeUndefined();
  });
});
