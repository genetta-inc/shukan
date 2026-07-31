import { describe, it, expect } from 'vitest';
import { toUserProfile, type UserProfileRow } from '@/lib/supabase/profiles';

// --- toUserProfile: snake_case Row → camelCase ドメイン型 マッピング ---
// B-S3 / B-S1: 作成済みプロフィールは camelCase（trackedKpis は選択順 string 配列）で返る。
// マッピングの流儀は habits.ts の toXxx() に合わせ、純粋関数として単体検証する。

function makeRow(overrides: Partial<UserProfileRow> = {}): UserProfileRow {
  return {
    user_id: 'user-123',
    birth_year: 1984,
    gender: 'male',
    country: 'JP',
    annual_income: 15_000_000,
    currency: 'JPY',
    tracked_kpis: ['cost_saving'],
    created_at: '2026-06-12T00:00:00.000Z',
    updated_at: '2026-06-12T00:00:00.000Z',
    tutorial_completed_at: null,
    ...overrides,
  };
}

describe('toUserProfile', () => {
  it('snake_case の全カラムを camelCase にマッピングする', () => {
    const profile = toUserProfile(makeRow());
    expect(profile).toEqual({
      userId: 'user-123',
      birthYear: 1984,
      gender: 'male',
      country: 'JP',
      annualIncome: 15_000_000,
      currency: 'JPY',
      trackedKpis: ['cost_saving'],
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:00.000Z',
      tutorialCompletedAt: null,
    });
  });

  it('annual_income が null のとき annualIncome は null になる', () => {
    const profile = toUserProfile(makeRow({ annual_income: null }));
    expect(profile.annualIncome).toBeNull();
  });

  it('birth_year が null のとき birthYear は null になる', () => {
    const profile = toUserProfile(makeRow({ birth_year: null }));
    expect(profile.birthYear).toBeNull();
  });

  it('tracked_kpis 配列の順序を保持する', () => {
    const profile = toUserProfile(
      makeRow({ tracked_kpis: ['earning', 'health_lifespan', 'cost_saving'] })
    );
    expect(profile.trackedKpis).toEqual(['earning', 'health_lifespan', 'cost_saving']);
  });

  it('tracked_kpis が空配列のときは空配列を返す', () => {
    const profile = toUserProfile(makeRow({ tracked_kpis: [] }));
    expect(profile.trackedKpis).toEqual([]);
  });

  it('gender 4種をそのまま通す', () => {
    for (const g of ['male', 'female', 'other', 'unspecified'] as const) {
      expect(toUserProfile(makeRow({ gender: g })).gender).toBe(g);
    }
  });

  // issue #117: 初回チュートリアルの表示制御を DB 正にするためのカラム
  it('tutorial_completed_at が null のとき tutorialCompletedAt は null になる', () => {
    const profile = toUserProfile(makeRow({ tutorial_completed_at: null }));
    expect(profile.tutorialCompletedAt).toBeNull();
  });

  it('tutorial_completed_at の値をそのまま tutorialCompletedAt に渡す', () => {
    const profile = toUserProfile(makeRow({ tutorial_completed_at: '2026-07-25T10:00:00.000Z' }));
    expect(profile.tutorialCompletedAt).toBe('2026-07-25T10:00:00.000Z');
  });
});
