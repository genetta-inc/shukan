import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// issue #89: エビデンス記事への構造化投票（4択）+ 継続日数スナップショットの
// マイグレーション SQL 内容検証。実 DB の RLS / CHECK 検証はユニットでは不可
// （認証セッションが要る）ため、マイグレーション SQL 定義の存在で代替する
// （既存 habit-status-migration.test.ts / user-profiles-migration.test.ts と同方針）。

const sql = readFileSync(
  join(__dirname, '../../supabase/migrations/20260724060000_article_verdicts.sql'),
  'utf-8'
).toLowerCase();

describe('article_verdicts migration: テーブル定義', () => {
  it('article_verdicts テーブルを新規作成する（既存テーブルは変更しない）', () => {
    expect(sql).toMatch(/create table\s+(if not exists\s+)?public\.article_verdicts/);
    expect(sql).not.toMatch(/alter table\s+(public\.)?article_feedbacks/);
    expect(sql).not.toMatch(/drop table/);
  });

  it('verdict に4択の check 制約を付ける（受け入れ条件: 4択投票）', () => {
    expect(sql).toMatch(
      /check\s*\(\s*verdict\s+in\s*\(\s*'too_high'\s*,\s*'too_low'\s*,\s*'fair'\s*,\s*'incorrect'\s*\)\s*\)/
    );
  });

  it('voter_streak_days（継続日数スナップショット）を not null default 0 で持つ（受け入れ条件2）', () => {
    expect(sql).toMatch(/voter_streak_days\s+integer\s+not null\s+default\s+0/);
  });

  it('user_id + article_id に unique 制約を付ける（1ユーザー1記事1票・変更可）', () => {
    expect(sql).toMatch(/unique\s*\(\s*user_id\s*,\s*article_id\s*\)/);
  });
});

describe('article_verdicts migration: RLS', () => {
  it('RLS を有効化する', () => {
    expect(sql).toMatch(/alter table\s+public\.article_verdicts\s+enable row level security/);
  });

  it('select/insert/update ポリシーを自分の行に限定する', () => {
    expect(sql).toMatch(/for select\s*\n?\s*using\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/);
    expect(sql).toMatch(/for insert\s*\n?\s*with check\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/);
    expect(sql).toMatch(/for update\s*\n?\s*using\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/);
  });

  it('既存のポリシー・テーブルを破壊しない（drop policy を含まない）', () => {
    expect(sql).not.toMatch(/drop policy/);
  });
});

describe('article_verdicts migration: 集計ビュー', () => {
  it('article_verdict_stats ビューで記事ごとの票数内訳が取得できる（受け入れ条件3）', () => {
    expect(sql).toMatch(/create or replace view\s+public\.article_verdict_stats/);
    expect(sql).toMatch(/too_high_count/);
    expect(sql).toMatch(/too_low_count/);
    expect(sql).toMatch(/fair_count/);
    expect(sql).toMatch(/incorrect_count/);
    expect(sql).toMatch(/group by\s+article_id/);
  });
});
