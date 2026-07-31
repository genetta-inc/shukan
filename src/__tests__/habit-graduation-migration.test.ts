import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// habits テーブルへの graduation_declined_at 列追加マイグレーションの SQL 内容検証。
// issue #91 AC#3（「まだ続ける」を選んだ習慣には再提案しない）を DB 側で恒久化するためのカラム。
// 実 DB の RLS 検証はユニットでは不可のため、マイグレーション SQL 定義の存在で代替する
// （既存 habit-status-migration.test.ts と同方針）。

const sql = readFileSync(
  join(__dirname, '../../supabase/migrations/20260725000000_habit_graduation_dismissed.sql'),
  'utf-8'
).toLowerCase();

describe('habit graduation_declined_at migration: 列追加', () => {
  it('habits テーブルを alter table で変更する（既存テーブルを drop/recreate しない）', () => {
    expect(sql).toMatch(/alter table\s+(public\.)?habits/);
    expect(sql).not.toMatch(/drop table/);
    expect(sql).not.toMatch(/create table\s+(public\.)?habits/);
  });

  it('graduation_declined_at を add column if not exists で追加する', () => {
    expect(sql).toMatch(/add column\s+if not exists\s+graduation_declined_at\s+timestamptz/);
  });

  it('graduation_declined_at は nullable（not null を付けない。既存行は NULL=未選択で壊れない）', () => {
    expect(sql).not.toMatch(/graduation_declined_at\s+timestamptz\s+not null/);
  });

  it('既存 RLS ポリシーを破壊しない（drop policy を含まない）', () => {
    expect(sql).not.toMatch(/drop policy/);
  });
});
