import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// user_profiles.tutorial_completed_at 追加マイグレーション SQL の内容検証（issue #117）。
// 実 DB への適用結果（バックフィル含む）はユニットでは検証できないため、
// SQL の定義内容の存在で代替する（user-profiles-migration.test.ts と同じ方針）。

const sql = readFileSync(
  join(__dirname, '../../supabase/migrations/20260725100000_user_profiles_tutorial_completed_at.sql'),
  'utf-8'
).toLowerCase();

describe('user_profiles.tutorial_completed_at 追加マイグレーション', () => {
  it('tutorial_completed_at を timestamptz（nullable）で追加する', () => {
    expect(sql).toMatch(/add column if not exists\s+tutorial_completed_at\s+timestamptz/);
    // not null を付けない（nullable = 未完了を表す）
    expect(sql).not.toMatch(/tutorial_completed_at\s+timestamptz\s+not null/);
  });

  it('既存行（適用時点で null の行）を now() でバックフィルする', () => {
    expect(sql).toMatch(/update\s+public\.user_profiles/);
    expect(sql).toMatch(/set\s+tutorial_completed_at\s*=\s*now\(\)/);
    expect(sql).toMatch(/where\s+tutorial_completed_at\s+is\s+null/);
  });
});
